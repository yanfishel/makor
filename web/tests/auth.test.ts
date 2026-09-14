import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { apiKeys, users } from "@/lib/db/schema";
import { hashApiKey } from "@/lib/api-keys";
import { AuthError, getPrincipal } from "@/lib/auth";
import { recordInvitation } from "@/lib/invitations";
import { ensureUser, getUser } from "@/lib/users";

const TOKEN = "ak_" + "a".repeat(43);

/** A plain (non-admin) users row for the key's owner, so it never shifts who "the first user" is. */
function dbWithKey(revoked = false, withUser = true) {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-auth-")), "t.sqlite3"));
  if (withUser) db.insert(users).values({ userId: "user_1", role: "user", trialUnlimited: false, email: null, createdAt: "2026-09-06T00:00:00Z", lastSeenAt: "2026-09-06T00:00:00Z" }).run();
  db.insert(apiKeys).values({ id: "k1", userId: "user_1", name: "test", prefix: TOKEN.slice(0, 8), hash: hashApiKey(TOKEN),
    createdAt: "2026-09-06T00:00:00Z", revokedAt: revoked ? "2026-09-06T01:00:00Z" : null }).run();
  return db;
}

const req = (headers: Record<string, string> = {}) => new Request("http://x/api/v1/extract", { method: "POST", headers });

describe("getPrincipal", () => {
  it("none mode without a header is the local user", async () => {
    await expect(getPrincipal(req(), { db: dbWithKey(), authMode: "none" })).resolves.toEqual({ userId: "local", apiKeyId: null, via: "session" });
  });
  it("a valid ak_ key wins over the mode", async () => {
    await expect(getPrincipal(req({ authorization: `Bearer ${TOKEN}` }), { db: dbWithKey(), authMode: "none" }))
      .resolves.toEqual({ userId: "user_1", apiKeyId: "k1", via: "api" });
  });
  it("an unknown or revoked key is TOKEN_INVALID", async () => {
    await expect(getPrincipal(req({ authorization: "Bearer ak_" + "b".repeat(43) }), { db: dbWithKey(), authMode: "none" })).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    await expect(getPrincipal(req({ authorization: `Bearer ${TOKEN}` }), { db: dbWithKey(true), authMode: "none" })).rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });
  it("a malformed bearer is TOKEN_INVALID, not a fallthrough to local", async () => {
    await expect(getPrincipal(req({ authorization: "Bearer nope" }), { db: dbWithKey(), authMode: "none" })).rejects.toBeInstanceOf(AuthError);
  });
  it("a valid key whose user row is gone is TOKEN_INVALID; with the row it resolves", async () => {
    await expect(getPrincipal(req({ authorization: `Bearer ${TOKEN}` }), { db: dbWithKey(false, false), authMode: "none" })).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    await expect(getPrincipal(req({ authorization: `Bearer ${TOKEN}` }), { db: dbWithKey(false, true), authMode: "none" })).resolves.toEqual({ userId: "user_1", apiKeyId: "k1", via: "api" });
  });
  it("clerk mode resolves the session user through the injected lookup", async () => {
    await expect(getPrincipal(req(), { db: dbWithKey(), authMode: "clerk", adminEmail: "a@example.com", sessionUserId: async () => "user_2abc", userEmails: async () => [{ email: "a@example.com", verified: true }] }))
      .resolves.toEqual({ userId: "user_2abc", apiKeyId: null, via: "session" });
    await expect(getPrincipal(req(), { db: dbWithKey(), authMode: "clerk", sessionUserId: async () => null })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("an ak_ key still wins over a session in clerk mode", async () => {
    await expect(getPrincipal(req({ authorization: `Bearer ${TOKEN}` }), { db: dbWithKey(), authMode: "clerk", sessionUserId: async () => "user_2abc" }))
      .resolves.toMatchObject({ userId: "user_1", via: "api" });
  });
});

describe("getPrincipal registers session users", () => {
  it("none mode: the local user is registered and, being first, is the admin", async () => {
    const db = dbWithKey();
    await getPrincipal(req(), { db, authMode: "none" });
    expect(getUser(db, "local")).toMatchObject({ role: "admin" });
  });
  it("clerk mode: an invited address is admitted, a stranger is INVITE_REQUIRED (403) and nothing is written", async () => {
    const db = dbWithKey();
    recordInvitation(db, { clerkInvitationId: "inv_1", email: "invitee@example.com", invitedBy: "system" }, new Date());
    const as = (userId: string, email: string, verified = true) => ({ db, authMode: "clerk" as const, adminEmail: null, sessionUserId: async () => userId, userEmails: async () => [{ email, verified }] });
    await expect(getPrincipal(req(), as("user_2abc", "invitee@example.com"))).resolves.toMatchObject({ userId: "user_2abc" });
    expect(getUser(db, "user_2abc")).toMatchObject({ role: "user", email: "invitee@example.com" });
    const refused = getPrincipal(req(), as("user_3def", "stranger@example.com"));
    await expect(refused).rejects.toMatchObject({ code: "INVITE_REQUIRED", status: 403 });
    expect(getUser(db, "user_3def")).toBeUndefined();
  });
  it("clerk mode: MAKOR_ADMIN_EMAIL is admitted as admin", async () => {
    const db = dbWithKey();
    await getPrincipal(req(), { db, authMode: "clerk", adminEmail: "admin@example.com", sessionUserId: async () => "user_admin", userEmails: async () => [{ email: "admin@example.com", verified: true }] });
    expect(getUser(db, "user_admin")).toMatchObject({ role: "admin" });
  });
  it("clerk mode: an existing row keeps access; a missing e-mail is looked up once, a failed lookup is not fatal", async () => {
    const db = dbWithKey();
    ensureUser(db, "user_old", new Date());
    let lookups = 0;
    const deps = (userEmails: () => Promise<{ email: string; verified: boolean }[]>) => ({ db, authMode: "clerk" as const, adminEmail: null, sessionUserId: async () => "user_old", userEmails });
    await expect(getPrincipal(req(), deps(async () => { throw new Error("clerk down"); }))).resolves.toMatchObject({ userId: "user_old" });
    await getPrincipal(req(), deps(async () => { lookups++; return [{ email: "Old@Example.com", verified: true }]; }));
    await getPrincipal(req(), deps(async () => { lookups++; return []; }));
    expect(lookups).toBe(1);
    expect(getUser(db, "user_old")?.email).toBe("old@example.com");
  });
  it("an ak_ key never registers or promotes anyone", async () => {
    const db = dbWithKey();
    const before = getUser(db, "user_1");
    await getPrincipal(req({ authorization: `Bearer ${TOKEN}` }), { db, authMode: "clerk" });
    expect(getUser(db, "user_1")).toEqual(before);
  });
});
