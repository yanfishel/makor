import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { documents, userSettings } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { getConfig } from "@/lib/config";
import { handleExtract, type HandlerDeps } from "@/lib/extract-handler";
import { startDocument } from "@/lib/documents";
import type { EngineResult } from "@/lib/engine";
import { AuthError, type Principal } from "@/lib/auth";
import { ensureUser, updateUser } from "@/lib/users";
import { openRegistriesDb, type RegistriesDb } from "@/lib/registries/db";
import { refreshSource } from "@/lib/registries/refresh";
import { SOURCES } from "@/lib/registries/sources";
import { fixtureHttp, tmpRegistriesFile } from "./registries-fixtures";
import { RateLimiter } from "@/lib/rate-limit";

const masterKey = randomBytes(32);
const okBody = { document_type: "teudat_zehut", fields: {}, validation: { overall: "unverified" }, warnings: [], regions: [], sefach: null,
  model: "anthropic/claude-opus-5", usage: [{ backend: "anthropic", model: "claude-opus-5", schema_name: "X", input_tokens: 100, output_tokens: 40, cache_read_tokens: 10, cache_write_tokens: 0 }] };

function setup(opts: { authMode?: "clerk" | "none"; engine?: EngineResult | Error; principal?: Principal; trialDocs?: number; env?: Record<string, string> } = {}) {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-h-")), "t.sqlite3"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: any[] = [];
  const deps: HandlerDeps = {
    db,
    config: getConfig({ AUTH_MODE: opts.authMode ?? "none", ENGINE_URL: "http://e", ENGINE_SECRET: "s", MAKOR_MASTER_KEY: masterKey.toString("base64"), DATA_DIR: "/x", TRIAL_DOCS: String(opts.trialDocs ?? 5), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y", ...opts.env }),
    masterKey,
    principal: async () => opts.principal ?? { userId: "local", apiKeyId: null, via: "session" },
    engine: async (file, filename, overrides) => {
      calls.push({ filename, overrides, size: file.size });
      if (opts.engine instanceof Error) throw opts.engine;
      return opts.engine ?? { status: 200, body: okBody, retryAfter: null };
    },
    now: () => new Date("2026-09-06T12:00:00Z"),
  };
  return { db, deps, calls };
}

function request(file: Blob | null = new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" })) {
  const form = new FormData();
  if (file) form.append("file", file, "doc.png");
  return new Request("http://x/api/v1/extract", { method: "POST", body: form });
}

function flagRequest(value: string) {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "doc.png");
  form.append("check_registries", value);
  return new Request("http://x/api/v1/extract", { method: "POST", body: form });
}

describe("handleExtract — local mode", () => {
  it("proxies, records a row, returns meta", async () => {
    const { db, deps, calls } = setup();
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document_type).toBe("teudat_zehut");
    expect(body.usage).toBeUndefined();
    expect(body.meta).toEqual({ mode: "local", trial_remaining: null, backend: "anthropic", model: "claude-opus-5", document_id: expect.any(String) });
    expect(calls[0].overrides).toEqual({});
    const row = db.select().from(documents).all()[0];
    expect(row).toMatchObject({ userId: "local", status: 200, docType: "teudat_zehut", verdict: "unverified", mode: "local", source: "ui",
      backend: "anthropic", model: "claude-opus-5", tokensIn: 100, tokensOut: 40, tokensCached: 10, resultEnc: null });
  });
  it("prices the engine's usage entries and stores the cost on the row", async () => {
    const { db, deps } = setup();
    await handleExtract(request(), deps);
    const row = db.select().from(documents).all()[0];
    expect(row.costUsd).toBeCloseTo((100 * 5 + 40 * 25 + 10 * 0.5) / 1_000_000, 12);
  });
  it("stores no cost for an ollama document", async () => {
    const body = { ...okBody, model: "ollama/qwen3-vl:8b-instruct", usage: [{ ...okBody.usage[0], backend: "ollama", model: "qwen3-vl:8b-instruct" }] };
    const { db, deps } = setup({ engine: { status: 200, body, retryAfter: null } });
    await handleExtract(request(), deps);
    expect(db.select().from(documents).all()[0].costUsd).toBeNull();
  });
  it("stores the encrypted result when store_results is on", async () => {
    const { db, deps } = setup();
    db.insert(userSettings).values({ userId: "local", storeResults: true, updatedAt: "x" }).run();
    await handleExtract(request(), deps);
    const row = db.select().from(documents).all()[0];
    expect(JSON.parse(decrypt(row.resultEnc!, masterKey)).document_type).toBe("teudat_zehut");
  });
  it("forwards the local backend with the LOCAL model; the key stays home for the ollama backend", async () => {
    const { db, deps, calls } = setup();
    db.insert(userSettings).values({ userId: "local", backend: "ollama", model: "claude-sonnet-5", localModel: "qwen3-vl:30b-a3b-instruct", anthropicKeyEnc: encrypt("sk-ant-u", masterKey), updatedAt: "x" }).run();
    await handleExtract(request(), deps);
    expect(calls[0].overrides).toEqual({ backend: "ollama", model: "qwen3-vl:30b-a3b-instruct" });
  });
  it("forwards the stored key and the CLOUD model when the local backend is anthropic", async () => {
    const { db, deps, calls } = setup();
    db.insert(userSettings).values({ userId: "local", backend: "anthropic", model: "claude-sonnet-5", localModel: "qwen3-vl:30b-a3b-instruct", anthropicKeyEnc: encrypt("sk-ant-u", masterKey), updatedAt: "x" }).run();
    await handleExtract(request(), deps);
    expect(calls[0].overrides).toEqual({ backend: "anthropic", model: "claude-sonnet-5", anthropicKey: "sk-ant-u" });
  });
  it("sends no model when no backend is chosen: a model name is backend-specific", async () => {
    const { db, deps, calls } = setup();
    db.insert(userSettings).values({ userId: "local", model: "claude-sonnet-5", localModel: "qwen3-vl:30b-a3b-instruct", updatedAt: "x" }).run();
    await handleExtract(request(), deps);
    expect(calls[0].overrides).toEqual({});
  });
  it("rejects a missing file and an oversized file before calling the engine", async () => {
    const { deps, calls } = setup();
    expect((await handleExtract(request(null), deps)).status).toBe(400);
    const big = new Blob([Buffer.alloc(30 * 1024 * 1024 + 1)], { type: "image/png" });
    expect((await handleExtract(request(big), deps)).status).toBe(413);
    expect(calls).toHaveLength(0);
  });
  it("accepts a 20 MB upload now that the cap is 30 MB", async () => {
    const { deps, calls } = setup();
    const twenty = new Blob([Buffer.alloc(20 * 1024 * 1024)], { type: "image/png" });
    expect((await handleExtract(request(twenty), deps)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });
  it("accepts a PDF and passes it to the engine", async () => {
    const { deps, calls } = setup();
    const pdf = new Blob([Buffer.from("%PDF-1.4 ...")], { type: "application/pdf" });
    expect((await handleExtract(request(pdf), deps)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });
  it("still rejects a file that is neither an image nor a PDF", async () => {
    const { deps, calls } = setup();
    const text = new Blob([Buffer.from("hello")], { type: "text/plain" });
    expect((await handleExtract(request(text), deps)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("records failures too", async () => {
    const { db, deps } = setup({ engine: { status: 422, body: { detail: "Model declined" }, retryAfter: null } });
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "ENGINE_ERROR", detail: "Model declined" });
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 422, errorCode: "ENGINE_ERROR" });
  });
  it("passes Retry-After through on 503", async () => {
    const { deps } = setup({ engine: { status: 503, body: { detail: "busy" }, retryAfter: "30" } });
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });
  it("maps an unreachable engine to 503 ENGINE_UNAVAILABLE", async () => {
    const { EngineUnavailable } = await import("@/lib/engine");
    const { deps } = setup({ engine: new EngineUnavailable("down") });
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("ENGINE_UNAVAILABLE");
  });
  it("maps an engine timeout to 504 ENGINE_TIMEOUT", async () => {
    const { EngineTimeout } = await import("@/lib/engine");
    const { db, deps } = setup({ engine: new EngineTimeout("slow") });
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "ENGINE_TIMEOUT", detail: "Extraction did not finish in time, retry later" });
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 504, errorCode: "ENGINE_TIMEOUT" });
  });
  it("source is api when the principal came from a key", async () => {
    const { db, deps } = setup({ principal: { userId: "u1", apiKeyId: "k1", via: "api" } });
    await handleExtract(request(), deps);
    expect(db.select().from(documents).all()[0]).toMatchObject({ source: "api", apiKeyId: "k1" });
  });
});

describe("handleExtract — clerk mode (trial/byok)", () => {
  const p: Principal = { userId: "user_1", apiKeyId: null, via: "session" };
  it("runs the trial on the engine's own key and counts down", async () => {
    const { deps, calls } = setup({ authMode: "clerk", principal: p, trialDocs: 2 });
    const body = await (await handleExtract(request(), deps)).json();
    expect(body.meta).toMatchObject({ mode: "trial", trial_remaining: 1 });
    expect(calls[0].overrides).toEqual({ backend: "anthropic" });
    const body2 = await (await handleExtract(request(), deps)).json();
    expect(body2.meta.trial_remaining).toBe(0);
    const res3 = await handleExtract(request(), deps);
    expect(res3.status).toBe(402);
    expect(await res3.json()).toMatchObject({ error: "TRIAL_EXHAUSTED", trial_docs: 2 });
    expect(calls).toHaveLength(2);
  });
  it("byok sends the user's key and never touches the trial", async () => {
    const { db, deps, calls } = setup({ authMode: "clerk", principal: p, trialDocs: 0 });
    db.insert(userSettings).values({ userId: "user_1", anthropicKeyEnc: encrypt("sk-ant-u", masterKey), model: "claude-sonnet-5", updatedAt: "x" }).run();
    const body = await (await handleExtract(request(), deps)).json();
    expect(body.meta).toMatchObject({ mode: "byok", trial_remaining: null });
    expect(calls[0].overrides).toEqual({ backend: "anthropic", model: "claude-sonnet-5", anthropicKey: "sk-ant-u" });
  });
  it("turns the engine's rejected-key 502 into 400 ANTHROPIC_KEY_INVALID", async () => {
    const { db, deps } = setup({ authMode: "clerk", principal: p, engine: { status: 502, body: { detail: { message: "rejected", anthropic_status: 401 } }, retryAfter: null } });
    db.insert(userSettings).values({ userId: "user_1", anthropicKeyEnc: encrypt("sk-ant-bad", masterKey), updatedAt: "x" }).run();
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ANTHROPIC_KEY_INVALID");
    expect(db.select().from(documents).all()[0].errorCode).toBe("ANTHROPIC_KEY_INVALID");
  });
  it("unauthenticated is 401", async () => {
    const { AuthError } = await import("@/lib/auth");
    const { deps } = setup({ authMode: "clerk" });
    deps.principal = async () => { throw new AuthError("UNAUTHENTICATED", "Sign in required"); };
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("UNAUTHENTICATED");
  });
});

describe("handleExtract — plan 2 mappings", () => {
  it("engine 401/403 become 502 ENGINE_MISCONFIGURED", async () => {
    const { db, deps } = setup({ engine: { status: 401, body: { detail: "Missing or wrong X-Engine-Secret" }, retryAfter: null } });
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("ENGINE_MISCONFIGURED");
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 502, errorCode: "ENGINE_MISCONFIGURED" });
  });
  it("an undecryptable stored key is 500 KEY_DECRYPT_FAILED without an engine call", async () => {
    const { db, deps, calls } = setup();
    db.insert(userSettings).values({ userId: "local", anthropicKeyEnc: "v1:AAAA:BBBB:CCCC", updatedAt: "x" }).run();
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("KEY_DECRYPT_FAILED");
    expect(calls).toHaveLength(0);
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 500, errorCode: "KEY_DECRYPT_FAILED" });
  });
  it("pre-engine rejects record a row; 401 does not", async () => {
    const { db, deps } = setup();
    await handleExtract(request(null), deps);
    const big = new Blob([Buffer.alloc(30 * 1024 * 1024 + 1)], { type: "image/png" });
    await handleExtract(request(big), deps);
    const rows = db.select().from(documents).all();
    expect(rows.map((r) => [r.status, r.errorCode])).toEqual([[400, "NO_FILE"], [413, "TOO_LARGE"]]);
    const { AuthError } = await import("@/lib/auth");
    deps.principal = async () => { throw new AuthError("UNAUTHENTICATED", "Sign in required"); };
    await handleExtract(request(), deps);
    expect(db.select().from(documents).all()).toHaveLength(2);
  });
  it("402 records a trial row", async () => {
    const { db, deps } = setup({ authMode: "clerk", principal: { userId: "user_1", apiKeyId: null, via: "session" }, trialDocs: 0 });
    expect((await handleExtract(request(), deps)).status).toBe(402);
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 402, errorCode: "TRIAL_EXHAUSTED", mode: "trial" });
  });
});

describe("handleExtract — trial reservation", () => {
  it("two concurrent trial requests with one slot: one runs, one gets 402", async () => {
    const p: Principal = { userId: "user_1", apiKeyId: null, via: "session" };
    const { db, deps } = setup({ authMode: "clerk", principal: p, trialDocs: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    deps.engine = async () => { await gate; return { status: 200, body: okBody, retryAfter: null }; };
    const first = handleExtract(request(), deps);
    await new Promise((r) => setTimeout(r, 10));
    const second = await handleExtract(request(), deps);
    expect(second.status).toBe(402);
    release();
    expect((await first).status).toBe(200);
    const rows = db.select().from(documents).all();
    expect(rows.map((r) => r.status).sort()).toEqual([200, 402]);
  });
  it("a pending row is finished with the outcome, never left at 102", async () => {
    const { db, deps } = setup({ engine: { status: 502, body: { detail: "x" }, retryAfter: null } });
    await handleExtract(request(), deps);
    expect(db.select().from(documents).all()[0].status).toBe(502);
  });
  it("an unexpected throw from the engine still closes the reserved row and returns a JSON 500", async () => {
    const { db, deps } = setup({ engine: new Error("boom") });
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "INTERNAL", detail: "Unexpected error, retry later" });
    const rows = db.select().from(documents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 500, errorCode: "INTERNAL" });
  });
});

describe("handleExtract — key forwarding and model allow-list", () => {
  it("does not forward the key when the local backend is ollama", async () => {
    const { db, deps, calls } = setup();
    db.insert(userSettings).values({ userId: "local", backend: "ollama", anthropicKeyEnc: encrypt("sk-ant-u", masterKey), updatedAt: "x" }).run();
    await handleExtract(request(), deps);
    expect(calls[0].overrides).toEqual({ backend: "ollama" });
  });
  it("clerk mode ignores a model outside the allow-list", async () => {
    const p: Principal = { userId: "user_1", apiKeyId: null, via: "session" };
    const { db, deps, calls } = setup({ authMode: "clerk", principal: p });
    db.insert(userSettings).values({ userId: "user_1", model: "claude-opus-4-1", anthropicKeyEnc: encrypt("sk-ant-u", masterKey), updatedAt: "x" }).run();
    await handleExtract(request(), deps);
    expect(calls[0].overrides).toEqual({ backend: "anthropic", anthropicKey: "sk-ant-u" });
  });
});

describe("handleExtract — pending window follows the engine timeout", () => {
  it("a pending trial row older than timeout+60s no longer blocks a new request", async () => {
    const p: Principal = { userId: "user_1", apiKeyId: null, via: "session" };
    const { db, deps } = setup({ authMode: "clerk", principal: p, trialDocs: 1, env: { ENGINE_TIMEOUT_MS: "60000" } });
    const stale = new Date(deps.now!().getTime() - 130_000).toISOString();   // > 60 s + 60 s
    startDocument(db, { id: "old", userId: "user_1", mode: "trial", source: "ui", createdAt: stale });
    expect((await handleExtract(request(), deps)).status).toBe(200);
  });
});

describe("handleExtract — unlimited users (admin / exempted)", () => {
  it("an admin past the cap is served on the server key: no reservation, no remaining, no X-Anthropic-Key", async () => {
    const p: Principal = { userId: "user_1", apiKeyId: null, via: "session" };
    const { db, deps, calls } = setup({ authMode: "clerk", principal: p, trialDocs: 1 });
    ensureUser(db, "user_1", deps.now!());   // first user → admin
    for (let i = 0; i < 3; i++) {
      const res = await handleExtract(request(), deps);
      expect(res.status).toBe(200);
      expect((await res.json()).meta).toMatchObject({ mode: "trial", trial_remaining: null });
    }
    expect(calls.every((c) => c.overrides.anthropicKey === undefined)).toBe(true);
    expect(db.select().from(documents).all().filter((r) => r.status === 200 && r.mode === "trial")).toHaveLength(3);
  });
  it("a plain user flagged trial_unlimited by an admin gets the same treatment", async () => {
    const p: Principal = { userId: "user_2", apiKeyId: null, via: "session" };
    const { db, deps } = setup({ authMode: "clerk", principal: p, trialDocs: 0 });
    ensureUser(db, "user_1", deps.now!());
    ensureUser(db, "user_2", deps.now!());
    expect((await handleExtract(request(), deps)).status).toBe(402);
    updateUser(db, "user_2", { trialUnlimited: true });
    expect((await handleExtract(request(), deps)).status).toBe(200);
  });
});

describe("handleExtract — registries check", () => {
  let registries: RegistriesDb;
  beforeAll(async () => {
    registries = openRegistriesDb(tmpRegistriesFile());
    for (const def of SOURCES) await refreshSource(registries, def, fixtureHttp());
  });
  const withId = { status: 200, body: { ...okBody, fields: { id_number: { value: "123456782", confidence: "high" } } }, retryAfter: null };

  it("off (the default): registries is null in the response and on the row, and the database is never opened", async () => {
    const { db, deps } = setup({ engine: withId });
    deps.registriesDb = () => { throw new Error("must not be opened"); };
    const body = await (await handleExtract(request(), deps)).json();
    expect(body.registries).toBeNull();
    expect(db.select().from(documents).all()[0].registries).toBeNull();
  });

  it("on: matches in the response, a value-free summary on the row, details inside the stored result", async () => {
    const { db, deps } = setup({ engine: withId });
    deps.registriesDb = () => registries;
    db.insert(userSettings).values({ userId: "local", storeResults: true, checkRegistries: true, updatedAt: "x" }).run();
    const body = await (await handleExtract(request(), deps)).json();
    expect(body.registries.matches.map((m: { source: string; by: string; level: string }) => [m.level, m.source, m.by])).toEqual([["alert", "nbctf_individuals", "id"]]);
    expect(body.registries.checked).toEqual(["id_number"]);
    const row = db.select().from(documents).all()[0];
    expect(JSON.parse(row.registries!)).toEqual({ alerts: [{ source: "nbctf_individuals", by: "id", count: 1 }], infos: [], checked: ["id_number"] });
    expect(row.registries).not.toContain("123456782");
    expect(JSON.parse(decrypt(row.resultEnc!, masterKey)).registries.matches).toHaveLength(1);
  });

  it("a failing check still finishes the extraction at 200", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, deps } = setup({ engine: withId });
    deps.registriesDb = () => { throw new Error("disk I/O error"); };
    db.insert(userSettings).values({ userId: "local", checkRegistries: true, updatedAt: "x" }).run();
    const res = await handleExtract(request(), deps);
    expect(res.status).toBe(200);
    expect((await res.json()).registries).toEqual({ error: "REGISTRIES_UNAVAILABLE" });
    const row = db.select().from(documents).all()[0];
    expect(row).toMatchObject({ status: 200 });
    expect(JSON.parse(row.registries!)).toEqual({ error: "REGISTRIES_UNAVAILABLE" });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("disk I/O error"));
    errorSpy.mockRestore();
  });

  it("check_registries=true checks this request even with the setting off", async () => {
    const { db, deps } = setup({ engine: withId });
    deps.registriesDb = () => registries;
    const body = await (await handleExtract(flagRequest("true"), deps)).json();
    expect(body.registries.matches.map((m: { source: string }) => m.source)).toEqual(["nbctf_individuals"]);
    expect(JSON.parse(db.select().from(documents).all()[0].registries!).alerts).toHaveLength(1);
  });

  it("check_registries=false skips the check even with the setting on", async () => {
    const { db, deps } = setup({ engine: withId });
    deps.registriesDb = () => { throw new Error("must not be opened"); };
    db.insert(userSettings).values({ userId: "local", checkRegistries: true, updatedAt: "x" }).run();
    const body = await (await handleExtract(flagRequest("false"), deps)).json();
    expect(body.registries).toBeNull();
    expect(db.select().from(documents).all()[0].registries).toBeNull();
  });

  it("any other check_registries value is a 400 before the engine, with the row recorded", async () => {
    const { db, deps, calls } = setup({ engine: withId });
    const res = await handleExtract(flagRequest("yes"), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_BODY");
    expect(calls).toHaveLength(0);
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 400, errorCode: "INVALID_BODY" });
  });
});

describe("handleExtract — rate limit", () => {
  it("a request over the key's budget is 429 before any row or engine call", async () => {
    const principal: Principal = { userId: "local", apiKeyId: "k1", via: "api" };
    const { db, deps, calls } = setup({ principal, env: { API_RATE_LIMIT_PER_MIN: "1" } });
    deps.limiter = new RateLimiter(() => 0);
    expect((await handleExtract(request(), deps)).status).toBe(200);
    const refused = await handleExtract(request(), deps);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toBe("RATE_LIMITED");
    expect(calls).toHaveLength(1);
    expect(db.select().from(documents).all()).toHaveLength(1);
  });

  it("resolves the principal once, and a bad token is 401 before any engine call", async () => {
    const principal: Principal = { userId: "local", apiKeyId: "k1", via: "api" };
    const { deps } = setup({ principal, env: { API_RATE_LIMIT_PER_MIN: "1" } });
    const limiter = new RateLimiter(() => 0);
    deps.limiter = limiter;
    let lookups = 0;
    deps.principal = async () => { lookups += 1; return principal; };
    expect((await handleExtract(request(), deps)).status).toBe(200);
    expect(lookups).toBe(1);
    const bad = setup({ env: { API_RATE_LIMIT_PER_MIN: "1" } });
    bad.deps.limiter = limiter;
    bad.deps.principal = async () => { throw new AuthError("TOKEN_INVALID", "bad key"); };
    expect((await handleExtract(request(), bad.deps)).status).toBe(401);
    expect(bad.calls).toHaveLength(0);
  });
});
