import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Principal } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { openDb } from "@/lib/db";
import { getInvitation, pendingInvitation, recordInvitation, type ClerkAdminPort } from "@/lib/invitations";
import { handleCreateInvitation, handleListInvitations, handleResendInvitation, handleRevokeInvitation } from "@/lib/invitations-handlers";
import type { ReadDeps } from "@/lib/usage-handlers";
import { ensureUser, setUserEmail } from "@/lib/users";

const masterKey = randomBytes(32);
const T0 = new Date("2026-09-13T12:00:00Z");
const CLERK_ENV = { AUTH_MODE: "clerk", ENGINE_URL: "http://e", ENGINE_SECRET: "s", MAKOR_MASTER_KEY: masterKey.toString("base64"), DATA_DIR: "/x", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y", NEXT_PUBLIC_SITE_URL: "https://makor.example" };
const admin: Principal = { userId: "user_admin", apiKeyId: null, via: "session" };

function fakeClerk(fail: { create?: boolean; revoke?: boolean; delete?: boolean } = {}) {
  const calls: string[] = [];
  let n = 0;
  const port: ClerkAdminPort = {
    async createInvitation(email, redirectUrl) { calls.push(`create ${email} ${redirectUrl}`); if (fail.create) throw Object.assign(new Error("x"), { status: 500 }); return { id: `inv_${++n}` }; },
    async revokeInvitation(id) { calls.push(`revoke ${id}`); if (fail.revoke) throw Object.assign(new Error("x"), { status: 500 }); },
    async deleteUser(id) { calls.push(`delete ${id}`); if (fail.delete) throw Object.assign(new Error("x"), { status: 500 }); },
  };
  return { port, calls };
}

function setup(opts: { principal?: Principal; fail?: Parameters<typeof fakeClerk>[0]; mode?: "clerk" | "none" } = {}) {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-invh-")), "t.sqlite3"));
  ensureUser(db, "user_admin", T0);
  ensureUser(db, "user_plain", T0);
  setUserEmail(db, "user_plain", "plain@example.com");
  const clerk = fakeClerk(opts.fail);
  const config = getConfig(opts.mode === "none" ? { AUTH_MODE: "none" } : CLERK_ENV);
  const deps: ReadDeps = { db, masterKey, config, principal: async () => opts.principal ?? admin, now: () => T0, clerkAdmin: opts.mode === "none" ? undefined : clerk.port };
  return { db, deps, calls: clerk.calls };
}
const post = (body: unknown) => new Request("http://x/api/admin/invitations", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const get = () => new Request("http://x/api/admin/invitations");
const code = async (r: Response) => (await r.json()).error;

describe("invitation handlers", () => {
  it("create: 201, Clerk called with the /invite redirect, row recorded; listed newest first", async () => {
    const { db, deps, calls } = setup();
    const res = await handleCreateInvitation(post({ email: " Invitee@Example.com " }), deps);
    expect(res.status).toBe(201);
    expect(calls).toEqual(["create invitee@example.com https://makor.example/invite"]);
    expect(pendingInvitation(db, "invitee@example.com")).toMatchObject({ clerkInvitationId: "inv_1", invitedBy: "user_admin" });
    const list = await (await handleListInvitations(get(), deps)).json();
    expect(list.invitations).toEqual([expect.objectContaining({ email: "invitee@example.com", status: "pending", invitedBy: "user_admin" })]);
  });
  it("create refuses invalid, registered and already-invited addresses; a Clerk failure writes nothing", async () => {
    const { db, deps } = setup();
    expect(await code(await handleCreateInvitation(post({ email: "nope" }), deps))).toBe("EMAIL_INVALID");
    expect(await code(await handleCreateInvitation(post({}), deps))).toBe("EMAIL_INVALID");
    expect(await code(await handleCreateInvitation(post({ email: "PLAIN@example.com" }), deps))).toBe("ALREADY_REGISTERED");
    await handleCreateInvitation(post({ email: "invitee@example.com" }), deps);
    const dup = await handleCreateInvitation(post({ email: "invitee@example.com" }), deps);
    expect([dup.status, await code(dup)]).toEqual([409, "ALREADY_INVITED"]);
    const failing = setup({ fail: { create: true } });
    const res = await handleCreateInvitation(post({ email: "other@example.com" }), failing.deps);
    expect([res.status, await code(res)]).toEqual([502, "INVITE_SEND_FAILED"]);
    expect(pendingInvitation(failing.db, "other@example.com")).toBeUndefined();
    expect(pendingInvitation(db, "other@example.com")).toBeUndefined();
  });
  it("an expired pending invitation can be replaced by a new one", async () => {
    const { db, deps } = setup();
    const old = recordInvitation(db, { clerkInvitationId: "inv_old", email: "invitee@example.com", invitedBy: "user_admin" }, new Date("2026-08-01T00:00:00Z"));
    expect((await handleCreateInvitation(post({ email: "invitee@example.com" }), deps)).status).toBe(201);
    expect(getInvitation(db, old.id)?.status).toBe("revoked");
  });
  it("resend creates the new Clerk invitation before revoking the old one; closed → 409; create failure → row unchanged", async () => {
    const { db, deps, calls } = setup();
    const row = recordInvitation(db, { clerkInvitationId: "inv_old", email: "invitee@example.com", invitedBy: "user_admin" }, new Date("2026-09-01T00:00:00Z"));
    const res = await handleResendInvitation(new Request("http://x", { method: "POST" }), row.id, deps);
    expect(res.status).toBe(200);
    expect(calls).toEqual(["create invitee@example.com https://makor.example/invite", "revoke inv_old"]);
    expect(getInvitation(db, row.id)).toMatchObject({ clerkInvitationId: "inv_1", createdAt: T0.toISOString() });
    expect((await handleResendInvitation(new Request("http://x", { method: "POST" }), "nope", deps)).status).toBe(404);
    const failing = setup({ fail: { create: true } });
    const r2 = recordInvitation(failing.db, { clerkInvitationId: "inv_old", email: "invitee@example.com", invitedBy: "user_admin" }, T0);
    expect(await code(await handleResendInvitation(new Request("http://x", { method: "POST" }), r2.id, failing.deps))).toBe("INVITE_SEND_FAILED");
    expect(getInvitation(failing.db, r2.id)?.clerkInvitationId).toBe("inv_old");
    await handleRevokeInvitation(new Request("http://x", { method: "DELETE" }), row.id, deps);
    expect(await code(await handleResendInvitation(new Request("http://x", { method: "POST" }), row.id, deps))).toBe("INVITATION_CLOSED");
  });
  it("resend still succeeds, with the new id recorded, when the old invitation's revoke fails after the create", async () => {
    const revokeFails = setup({ fail: { revoke: true } });
    const row = recordInvitation(revokeFails.db, { clerkInvitationId: "inv_old", email: "invitee@example.com", invitedBy: "user_admin" }, new Date("2026-09-01T00:00:00Z"));
    const res = await handleResendInvitation(new Request("http://x", { method: "POST" }), row.id, revokeFails.deps);
    expect(res.status).toBe(200);
    expect(revokeFails.calls).toEqual(["create invitee@example.com https://makor.example/invite", "revoke inv_old"]);
    expect(getInvitation(revokeFails.db, row.id)).toMatchObject({ clerkInvitationId: "inv_1", status: "pending" });
  });
  it("revoke: 204 and revoked; closed → 409; a Clerk failure keeps it pending", async () => {
    const { db, deps, calls } = setup();
    const row = recordInvitation(db, { clerkInvitationId: "inv_a", email: "invitee@example.com", invitedBy: "user_admin" }, T0);
    expect((await handleRevokeInvitation(new Request("http://x", { method: "DELETE" }), row.id, deps)).status).toBe(204);
    expect(calls).toEqual(["revoke inv_a"]);
    expect(getInvitation(db, row.id)?.status).toBe("revoked");
    expect(await code(await handleRevokeInvitation(new Request("http://x", { method: "DELETE" }), row.id, deps))).toBe("INVITATION_CLOSED");
    const failing = setup({ fail: { revoke: true } });
    const r2 = recordInvitation(failing.db, { clerkInvitationId: "inv_b", email: "invitee@example.com", invitedBy: "user_admin" }, T0);
    const res = await handleRevokeInvitation(new Request("http://x", { method: "DELETE" }), r2.id, failing.deps);
    expect([res.status, await code(res)]).toEqual([502, "INVITE_REVOKE_FAILED"]);
    expect(getInvitation(failing.db, r2.id)?.status).toBe("pending");
  });
  it("a plain user gets 403, none mode 404", async () => {
    expect(await code(await handleListInvitations(get(), setup({ principal: { userId: "user_plain", apiKeyId: null, via: "session" } }).deps))).toBe("ADMIN_REQUIRED");
    expect((await handleListInvitations(get(), setup({ mode: "none" }).deps)).status).toBe(404);
    expect((await handleCreateInvitation(post({ email: "invitee@example.com" }), setup({ mode: "none" }).deps)).status).toBe(404);
  });
});
