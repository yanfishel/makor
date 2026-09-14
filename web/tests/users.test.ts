import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { apiKeys, documents, invitations, userSettings } from "@/lib/db/schema";
import { recordDocument } from "@/lib/documents";
import { getInvitation, recordInvitation } from "@/lib/invitations";
import { adminCount, deleteUserData, ensureUser, getUser, isUnlimited, listUsers, registerSessionUser, setUserEmail, updateUser, userByEmail, userDetail } from "@/lib/users";

const fresh = () => openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-users-")), "t.sqlite3"));
const T0 = new Date("2026-09-06T12:00:00Z");

describe("ensureUser", () => {
  it("the first user becomes admin, the second a plain user", () => {
    const db = fresh();
    expect(ensureUser(db, "user_a", T0)).toMatchObject({ created: true, user: { userId: "user_a", role: "admin", trialUnlimited: false } });
    expect(ensureUser(db, "user_b", T0)).toMatchObject({ created: true, user: { role: "user" } });
    expect(adminCount(db)).toBe(1);
  });
  it("is idempotent and refreshes last_seen_at only after a minute", () => {
    const db = fresh();
    ensureUser(db, "user_a", T0);
    expect(ensureUser(db, "user_a", new Date(T0.getTime() + 10_000))).toMatchObject({ created: false, user: { lastSeenAt: T0.toISOString() } });
    const later = new Date(T0.getTime() + 120_000);
    expect(ensureUser(db, "user_a", later).user.lastSeenAt).toBe(later.toISOString());
    expect(getUser(db, "user_a")?.lastSeenAt).toBe(later.toISOString());
  });
  it("a later user is never promoted by accident when an admin already exists", () => {
    const db = fresh();
    ensureUser(db, "user_a", T0);
    updateUser(db, "user_a", { role: "user" });
    // No admin left: the next newcomer inherits the seat, as on a fresh deployment.
    expect(ensureUser(db, "user_c", T0).user.role).toBe("admin");
  });
});

describe("updateUser / isUnlimited", () => {
  it("toggles role and the trial exemption; unknown ids return undefined", () => {
    const db = fresh();
    ensureUser(db, "user_a", T0);
    ensureUser(db, "user_b", T0);
    expect(isUnlimited(getUser(db, "user_a"))).toBe(true);
    expect(isUnlimited(getUser(db, "user_b"))).toBe(false);
    expect(updateUser(db, "user_b", { trialUnlimited: true })).toMatchObject({ trialUnlimited: true, role: "user" });
    expect(isUnlimited(getUser(db, "user_b"))).toBe(true);
    expect(updateUser(db, "user_b", { role: "admin", trialUnlimited: false })).toMatchObject({ role: "admin", trialUnlimited: false });
    expect(updateUser(db, "ghost", { role: "admin" })).toBeUndefined();
    expect(isUnlimited(undefined)).toBe(false);
  });
});

describe("listUsers / userDetail", () => {
  it("aggregates documents per user and never leaks stored results", () => {
    const db = fresh();
    ensureUser(db, "user_a", T0);
    ensureUser(db, "user_b", new Date(T0.getTime() + 1000));
    setUserEmail(db, "user_b", "b@example.com");
    db.insert(userSettings).values({ userId: "user_b", anthropicKeyEnc: "v1:x:y:z", anthropicKeyLast4: "abcd", updatedAt: "x" }).run();
    recordDocument(db, { id: "d1", userId: "user_b", createdAt: "2026-09-01T00:00:00Z", status: 200, mode: "trial", source: "ui", resultEnc: "v1:a:b:c" });
    recordDocument(db, { id: "d2", userId: "user_b", createdAt: "2026-08-01T00:00:00Z", status: 502, mode: "trial", source: "api" });
    recordDocument(db, { id: "d3", userId: "user_b", createdAt: "2026-09-05T00:00:00Z", status: 200, mode: "trial", source: "ui" });
    const { users: list, total } = listUsers(db, T0, 60_000);
    expect(total).toBe(2);
    expect(list.map((u) => u.userId)).toEqual(["user_b", "user_a"]);
    expect(list[0]).toMatchObject({ email: "b@example.com", role: "user", unlimited: false, hasAnthropicKey: true, docsTotal: 3, docsOk: 2, docsThisMonth: 2, trialUsed: 2, lastDocumentAt: "2026-09-05T00:00:00Z" });
    expect(list[1]).toMatchObject({ role: "admin", unlimited: true, hasAnthropicKey: false, docsTotal: 0, trialUsed: 0, lastDocumentAt: null });
    const detail = userDetail(db, "user_b", T0, 60_000)!;
    expect(detail.usage).toMatchObject({ month: "2026-09", docsThisMonth: 2, okThisMonth: 2, total: 3 });
    expect(detail.stats.total).toBe(3);
    expect(detail.recent.map((d) => d.id)).toEqual(["d3", "d1", "d2"]);
    expect(JSON.stringify(detail)).not.toContain("v1:a:b:c");
    expect(userDetail(db, "ghost", T0, 60_000)).toBeUndefined();
  });
});

describe("registerSessionUser", () => {
  it("none mode (access null) registers anyone, the first as admin", async () => {
    const db = fresh();
    expect(await registerSessionUser(db, "local", null, T0)).toMatchObject({ userId: "local", role: "admin" });
  });
  it("clerk mode refuses a first sight nobody invited and propagates a failed lookup", async () => {
    const db = fresh();
    expect(await registerSessionUser(db, "user_x", { adminEmail: null, userEmails: async () => [{ email: "stranger@example.com", verified: true }] }, T0)).toBeNull();
    await expect(registerSessionUser(db, "user_y", { adminEmail: null, userEmails: async () => { throw new Error("clerk down"); } }, T0)).rejects.toThrow("clerk down");
    expect(getUser(db, "user_x")).toBeUndefined();
  });
});

describe("deleteUserData / userByEmail", () => {
  it("removes documents, keys, settings and the row; unlinks an accepted invitation", () => {
    const db = fresh();
    ensureUser(db, "user_a", T0);
    ensureUser(db, "user_b", T0);
    setUserEmail(db, "user_b", "invitee@example.com");
    recordDocument(db, { id: "d1", userId: "user_b", createdAt: T0.toISOString(), status: 200, mode: "trial", source: "ui" });
    recordDocument(db, { id: "d2", userId: "user_a", createdAt: T0.toISOString(), status: 200, mode: "trial", source: "ui" });
    db.insert(userSettings).values({ userId: "user_b", updatedAt: T0.toISOString() }).run();
    db.insert(apiKeys).values({ id: "k1", userId: "user_b", name: "n", prefix: "ak_xxxxx", hash: "h1", createdAt: T0.toISOString() }).run();
    const inv = recordInvitation(db, { clerkInvitationId: "inv_1", email: "invitee@example.com", invitedBy: "user_a" }, T0);
    db.update(invitations).set({ status: "accepted", acceptedUserId: "user_b" }).run();
    expect(userByEmail(db, "invitee@example.com")?.userId).toBe("user_b");
    expect(deleteUserData(db, "user_b")).toBe(true);
    expect(getUser(db, "user_b")).toBeUndefined();
    expect(db.select().from(documents).all().map((d) => d.id)).toEqual(["d2"]);
    expect(db.select().from(apiKeys).all()).toHaveLength(0);
    expect(db.select().from(userSettings).all()).toHaveLength(0);
    expect(getInvitation(db, inv.id)).toMatchObject({ status: "accepted", acceptedUserId: null });
    expect(deleteUserData(db, "nobody")).toBe(false);
  });
});

describe("listUsers paging", () => {
  it("limit/offset page through newest-first, total counts everyone", () => {
    const db = fresh();
    for (let i = 0; i < 5; i++) ensureUser(db, `user_${i}`, new Date(T0.getTime() + i * 1000));
    const p1 = listUsers(db, T0, 60_000, { limit: 2, offset: 0 });
    const p2 = listUsers(db, T0, 60_000, { limit: 2, offset: 2 });
    const p3 = listUsers(db, T0, 60_000, { limit: 2, offset: 4 });
    expect([p1, p2, p3].map((p) => p.users.map((u) => u.userId))).toEqual([["user_4", "user_3"], ["user_2", "user_1"], ["user_0"]]);
    expect(p1.total).toBe(5);
    expect(listUsers(db, T0, 60_000, { limit: 0, offset: -5 }).users).toHaveLength(1);
  });
});
