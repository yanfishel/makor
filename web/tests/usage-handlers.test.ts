import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { documents, userSettings } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import { getConfig } from "@/lib/config";
import { recordDocument, startDocument } from "@/lib/documents";
import { ensureUser } from "@/lib/users";
import { AuthError, type Principal } from "@/lib/auth";
import { handleDeleteAllResults, handleDeleteDocument, handleGetDocument, handleListDocuments, handleUsage, type ReadDeps } from "@/lib/usage-handlers";
import { RateLimiter } from "@/lib/rate-limit";

const masterKey = randomBytes(32);
const local: Principal = { userId: "local", apiKeyId: null, via: "session" };
function setup(authMode: "clerk" | "none" = "none", principal: Principal = local, trialDocs = 5, env: Record<string, string> = {}) {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-uh-")), "t.sqlite3"));
  const deps: ReadDeps = {
    db, masterKey, principal: async () => principal, now: () => new Date("2026-09-06T12:00:00Z"),
    config: getConfig({ AUTH_MODE: authMode, ENGINE_URL: "http://e", ENGINE_SECRET: "s", MAKOR_MASTER_KEY: masterKey.toString("base64"), DATA_DIR: "/x", TRIAL_DOCS: String(trialDocs), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y", ...env }),
  };
  return { db, deps };
}
const req = (url: string, method = "GET") => new Request(`http://x${url}`, { method });
const base = { userId: "local", source: "ui" as const, createdAt: "2026-09-06T10:00:00Z" };

describe("handleUsage", () => {
  it("local mode", async () => {
    const { db, deps } = setup();
    recordDocument(db, { ...base, id: "a", status: 200, mode: "local" });
    recordDocument(db, { ...base, id: "b", status: 502, mode: "local" });
    const body = await (await handleUsage(req("/api/v1/usage"), deps)).json();
    expect(body).toMatchObject({ mode: "local", trial_remaining: null, byok: false, month: "2026-09", docs_this_month: 2, ok_this_month: 1, failed_this_month: 1, total: 2 });
  });
  it("trial and byok in clerk mode", async () => {
    const p: Principal = { userId: "user_1", apiKeyId: null, via: "session" };
    const { db, deps } = setup("clerk", p, 2);
    recordDocument(db, { ...base, userId: "user_1", id: "a", status: 200, mode: "trial" });
    expect(await (await handleUsage(req("/api/v1/usage"), deps)).json()).toMatchObject({ mode: "trial", trial_docs: 2, trial_used: 1, trial_remaining: 1 });
    db.insert(userSettings).values({ userId: "user_1", anthropicKeyEnc: encrypt("sk-ant-x", masterKey), anthropicKeyLast4: "nt-x", updatedAt: "x" }).run();
    expect(await (await handleUsage(req("/api/v1/usage"), deps)).json()).toMatchObject({ mode: "byok", byok: true, trial_remaining: null });
  });
  it("401 without a principal", async () => {
    const { deps } = setup();
    deps.principal = async () => { throw new AuthError("UNAUTHENTICATED", "x"); };
    expect((await handleUsage(req("/api/v1/usage"), deps)).status).toBe(401);
  });
  it("a pending trial row older than timeout+60s no longer counts", async () => {
    const p: Principal = { userId: "user_1", apiKeyId: null, via: "session" };
    const { db, deps } = setup("clerk", p, 1, { ENGINE_TIMEOUT_MS: "60000" });
    const stale = new Date(deps.now!().getTime() - 130_000).toISOString();   // > 60 s + 60 s
    startDocument(db, { id: "old", userId: "user_1", mode: "trial", source: "ui", createdAt: stale });
    const body = await (await handleUsage(req("/api/v1/usage"), deps)).json();
    expect(body).toMatchObject({ trial_used: 0, trial_remaining: 1 });
  });
});

describe("documents handlers", () => {
  it("lists with paging params and hides other users", async () => {
    const { db, deps } = setup();
    for (let i = 0; i < 3; i++) recordDocument(db, { ...base, id: `d${i}`, status: 200, mode: "local", createdAt: `2026-09-0${i + 1}T00:00:00Z` });
    recordDocument(db, { ...base, id: "other", userId: "u2", status: 200, mode: "local" });
    const body = await (await handleListDocuments(req("/api/v1/documents?limit=2&offset=1"), deps)).json();
    expect(body.total).toBe(3);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["d1", "d0"]);
    expect(body.items[0]).not.toHaveProperty("resultEnc");
  });
  it("returns the decrypted result, NOT_STORED, NOT_FOUND, KEY_DECRYPT_FAILED", async () => {
    const { db, deps } = setup();
    recordDocument(db, { ...base, id: "a", status: 200, mode: "local", resultEnc: encrypt(JSON.stringify({ document_type: "teudat_zehut" }), masterKey) });
    recordDocument(db, { ...base, id: "b", status: 200, mode: "local" });
    recordDocument(db, { ...base, id: "c", status: 200, mode: "local", resultEnc: "v1:AAAA:BBBB:CCCC" });
    expect(await (await handleGetDocument(req("/x"), "a", deps)).json()).toEqual({ document_type: "teudat_zehut" });
    expect((await handleGetDocument(req("/x"), "b", deps)).status).toBe(404);
    expect((await (await handleGetDocument(req("/x"), "b", deps)).json()).error).toBe("NOT_STORED");
    expect((await (await handleGetDocument(req("/x"), "nope", deps)).json()).error).toBe("NOT_FOUND");
    expect((await (await handleGetDocument(req("/x"), "c", deps)).json()).error).toBe("KEY_DECRYPT_FAILED");
  });
  it("deletes one and all", async () => {
    const { db, deps } = setup();
    recordDocument(db, { ...base, id: "a", status: 200, mode: "local", resultEnc: "v1:a:b:c" });
    recordDocument(db, { ...base, id: "b", status: 200, mode: "local", resultEnc: "v1:a:b:c" });
    expect((await handleDeleteDocument(req("/x", "DELETE"), "a", deps)).status).toBe(204);
    expect((await handleDeleteDocument(req("/x", "DELETE"), "zzz", deps)).status).toBe(404);
    expect(await (await handleDeleteAllResults(req("/x", "DELETE"), deps)).json()).toEqual({ deleted: 1 });
    expect(db.select().from(documents).all().every((r) => r.resultEnc === null)).toBe(true);
  });
});

describe("handleUsage — unlimited users", () => {
  it("an admin past the trial cap is still on trial with no remaining count", async () => {
    const p: Principal = { userId: "user_1", apiKeyId: null, via: "session" };
    const { db, deps } = setup("clerk", p, 1);
    ensureUser(db, "user_1", deps.now!());   // first user → admin
    recordDocument(db, { ...base, userId: "user_1", id: "a", status: 200, mode: "trial" });
    recordDocument(db, { ...base, userId: "user_1", id: "b", status: 200, mode: "trial" });
    expect(await (await handleUsage(req("/api/v1/usage"), deps)).json()).toMatchObject({ mode: "trial", trial_used: 2, trial_remaining: null, unlimited: true });
  });
});

describe("rate limit on /api/v1/*", () => {
  const viaKey = (apiKeyId: string): Principal => ({ userId: "local", apiKeyId, via: "api" });
  it("the usage and documents routes share one per-key budget; the refusal is 429 RATE_LIMITED with Retry-After", async () => {
    const { deps } = setup("none", viaKey("k1"), 5, { API_RATE_LIMIT_PER_MIN: "2" });
    deps.limiter = new RateLimiter(() => 0);
    expect((await handleUsage(req("/api/v1/usage"), deps)).status).toBe(200);
    expect((await handleListDocuments(req("/api/v1/documents"), deps)).status).toBe(200);
    const refused = await handleGetDocument(req("/api/v1/documents/x"), "x", deps);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("30");
    expect(await refused.json()).toMatchObject({ error: "RATE_LIMITED", retry_after: 30 });
    expect((await handleDeleteDocument(req("/api/v1/documents/x", "DELETE"), "x", deps)).status).toBe(429);
    expect((await handleDeleteAllResults(req("/api/v1/documents", "DELETE"), deps)).status).toBe(429);
  });
  it("another key has its own budget, a bad token spends none, and 0 turns the limit off", async () => {
    const limiter = new RateLimiter(() => 0);
    const one = setup("none", viaKey("k1"), 5, { API_RATE_LIMIT_PER_MIN: "1" });
    one.deps.limiter = limiter;
    expect((await handleUsage(req("/api/v1/usage"), one.deps)).status).toBe(200);
    expect((await handleUsage(req("/api/v1/usage"), one.deps)).status).toBe(429);
    const other = setup("none", viaKey("k2"), 5, { API_RATE_LIMIT_PER_MIN: "1" });
    other.deps.limiter = limiter;
    expect((await handleUsage(req("/api/v1/usage"), other.deps)).status).toBe(200);
    const bad = setup("none", viaKey("k3"), 5, { API_RATE_LIMIT_PER_MIN: "1" });
    bad.deps.limiter = limiter;
    bad.deps.principal = async () => { throw new AuthError("TOKEN_INVALID", "bad key"); };
    expect((await handleUsage(req("/api/v1/usage"), bad.deps)).status).toBe(401);
    expect(limiter.take("api:key:k3", 1).ok).toBe(true);
    const off = setup("none", viaKey("k4"), 5, { API_RATE_LIMIT_PER_MIN: "0" });
    off.deps.limiter = limiter;
    for (let i = 0; i < 5; i++) expect((await handleUsage(req("/api/v1/usage"), off.deps)).status).toBe(200);
  });
});
