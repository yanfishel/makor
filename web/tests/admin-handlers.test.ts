import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { recordDocument } from "@/lib/documents";
import type { Principal } from "@/lib/auth";
import { ensureUser, getUser } from "@/lib/users";
import { handleDeleteUser, handleGetUser, handleListUsers, handlePatchUser } from "@/lib/admin-handlers";
import type { ReadDeps } from "@/lib/usage-handlers";

const masterKey = randomBytes(32);
const T0 = new Date("2026-09-06T12:00:00Z");
function setup(principal: Principal) {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-adm-")), "t.sqlite3"));
  ensureUser(db, "user_admin", T0);   // first → admin
  ensureUser(db, "user_plain", T0);
  const deps: ReadDeps = {
    db, masterKey, principal: async () => principal, now: () => T0,
    config: getConfig({ AUTH_MODE: "clerk", ENGINE_URL: "http://e", ENGINE_SECRET: "s", MAKOR_MASTER_KEY: masterKey.toString("base64"), DATA_DIR: "/x", TRIAL_DOCS: "3", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y" }),
  };
  return { db, deps };
}
const admin: Principal = { userId: "user_admin", apiKeyId: null, via: "session" };
const plain: Principal = { userId: "user_plain", apiKeyId: null, via: "session" };
const viaKey: Principal = { userId: "user_admin", apiKeyId: "k1", via: "api" };
const get = (url: string) => new Request(`http://x${url}`);
const patch = (url: string, body: unknown) => new Request(`http://x${url}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("admin handlers", () => {
  it("403 for a plain user, 403 SESSION_REQUIRED for an api key, 200 for the admin", async () => {
    expect((await (await handleListUsers(get("/api/admin/users"), setup(plain).deps)).json()).error).toBe("ADMIN_REQUIRED");
    expect((await (await handleListUsers(get("/api/admin/users"), setup(viaKey).deps)).json()).error).toBe("SESSION_REQUIRED");
    const body = await (await handleListUsers(get("/api/admin/users"), setup(admin).deps)).json();
    expect(body.trial_docs).toBe(3);
    expect(body.users.map((u: { userId: string; role: string }) => [u.userId, u.role]).sort()).toEqual([["user_admin", "admin"], ["user_plain", "user"]]);
    expect(body.total).toBe(2);
  });
  it("pages with limit/offset like /api/v1/documents", async () => {
    const { deps } = setup(admin);
    const body = await (await handleListUsers(get("/api/admin/users?limit=1&offset=1"), deps)).json();
    expect(body.users).toHaveLength(1);
    expect(body.total).toBe(2);
    expect((await (await handleListUsers(get("/api/admin/users?limit=x&offset=y"), deps)).json()).users).toHaveLength(2);
  });
  it("user detail carries stats and recent documents; unknown id is 404", async () => {
    const { db, deps } = setup(admin);
    recordDocument(db, { id: "d1", userId: "user_plain", createdAt: "2026-09-02T00:00:00Z", status: 200, mode: "trial", source: "ui", docType: "teudat_zehut", latencyMs: 1200 });
    const body = await (await handleGetUser(get("/x"), "user_plain", deps)).json();
    expect(body).toMatchObject({ userId: "user_plain", trialUsed: 1, docsTotal: 1, usage: { docsThisMonth: 1 }, stats: { total: 1, medianLatencyMs: 1200 } });
    expect(body.recent[0]).toMatchObject({ id: "d1", docType: "teudat_zehut" });
    expect((await handleGetUser(get("/x"), "nobody", deps)).status).toBe(404);
  });
  it("pages the user's recent documents with ?page=, clamped to the last page", async () => {
    const { db, deps } = setup(admin);
    for (let i = 0; i < 45; i++) recordDocument(db, { id: `d${i}`, userId: "user_plain", createdAt: `2026-09-01T${String(i % 24).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`, status: 200, mode: "trial", source: "ui" });
    const p1 = await (await handleGetUser(get("/x"), "user_plain", deps)).json();
    expect(p1).toMatchObject({ recentPage: 1, recentTotal: 45 });
    expect(p1.recent).toHaveLength(20);
    const p3 = await (await handleGetUser(get("/x?page=3"), "user_plain", deps)).json();
    expect(p3.recentPage).toBe(3);
    expect(p3.recent).toHaveLength(5);
    expect(new Set([...p1.recent, ...p3.recent].map((d: { id: string }) => d.id)).size).toBe(25);
    expect((await (await handleGetUser(get("/x?page=99"), "user_plain", deps)).json()).recentPage).toBe(3);
    expect((await (await handleGetUser(get("/x?page=abc"), "user_plain", deps)).json()).recentPage).toBe(1);
  });
  it("patches role and trial exemption, validates the body, refuses self-demotion", async () => {
    const { db, deps } = setup(admin);
    let res = await handlePatchUser(patch("/x", { trial_unlimited: true }), "user_plain", deps);
    expect(await res.json()).toMatchObject({ trialUnlimited: true, unlimited: true, role: "user" });
    res = await handlePatchUser(patch("/x", { role: "admin", trial_unlimited: false }), "user_plain", deps);
    expect(await res.json()).toMatchObject({ role: "admin", trialUnlimited: false, unlimited: true });
    expect(getUser(db, "user_plain")?.role).toBe("admin");
    expect((await handlePatchUser(patch("/x", { role: "owner" }), "user_plain", deps)).status).toBe(400);
    expect((await handlePatchUser(patch("/x", { trial_unlimited: "yes" }), "user_plain", deps)).status).toBe(400);
    expect((await handlePatchUser(new Request("http://x", { method: "PATCH", body: "{" }), "user_plain", deps)).status).toBe(400);
    expect((await (await handlePatchUser(patch("/x", { role: "user" }), "user_admin", deps)).json()).error).toBe("SELF_DEMOTE");
    expect((await handlePatchUser(patch("/x", { role: "user" }), "nobody", deps)).status).toBe(404);
  });
  it("a plain user cannot patch anyone, including themselves", async () => {
    const { deps } = setup(plain);
    expect((await handlePatchUser(patch("/x", { role: "admin" }), "user_plain", deps)).status).toBe(403);
  });
});

describe("DELETE /api/admin/users/:id", () => {
  const clerkPort = (fail = false) => {
    const calls: string[] = [];
    return { calls, port: { createInvitation: async () => ({ id: "x" }), revokeInvitation: async () => {}, deleteUser: async (id: string) => { calls.push(id); if (fail) throw Object.assign(new Error("x"), { status: 500 }); } } };
  };
  const del = () => new Request("http://x", { method: "DELETE" });
  it("deletes the Clerk account first, then the local data", async () => {
    const { db, deps } = setup(admin);
    const clerk = clerkPort();
    recordDocument(db, { id: "d1", userId: "user_plain", createdAt: "2026-09-02T00:00:00Z", status: 200, mode: "trial", source: "ui" });
    const res = await handleDeleteUser(del(), "user_plain", { ...deps, clerkAdmin: clerk.port });
    expect(res.status).toBe(204);
    expect(clerk.calls).toEqual(["user_plain"]);
    expect(getUser(db, "user_plain")).toBeUndefined();
  });
  it("SELF_DELETE, 404, and a Clerk failure deletes nothing", async () => {
    const { db, deps } = setup(admin);
    expect((await (await handleDeleteUser(del(), "user_admin", { ...deps, clerkAdmin: clerkPort().port })).json()).error).toBe("SELF_DELETE");
    expect((await handleDeleteUser(del(), "nobody", { ...deps, clerkAdmin: clerkPort().port })).status).toBe(404);
    const res = await handleDeleteUser(del(), "user_plain", { ...deps, clerkAdmin: clerkPort(true).port });
    expect([res.status, (await res.json()).error]).toEqual([502, "USER_DELETE_FAILED"]);
    expect(getUser(db, "user_plain")).toBeDefined();
  });
  it("none mode (no Clerk) answers 404", async () => {
    const { deps } = setup(admin);
    expect((await handleDeleteUser(del(), "user_plain", deps)).status).toBe(404);
  });
});
