import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { documents, userSettings } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { getConfig } from "@/lib/config";
import { EngineUnavailable, type EngineStreamResult } from "@/lib/engine";
import { handleExtractStream, type StreamDeps } from "@/lib/extract-stream-handler";
import type { Principal } from "@/lib/auth";

const masterKey = randomBytes(32);
const result = { document_type: "teudat_zehut", fields: {}, validation: { overall: "unverified" }, warnings: [], regions: [], sefach: null,
  model: "anthropic/claude-opus-5", usage: [{ backend: "anthropic", model: "claude-opus-5", schema_name: "X", input_tokens: 100, output_tokens: 40, cache_read_tokens: 10, cache_write_tokens: 0 }] };

function lines(events: object[], delayMs = 0): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= events.length) return controller.close();
      const line = JSON.stringify(events[i++]) + "\n";
      // A cancel() (idle timeout, or the response cancelled mid-stream) that lands between
      // this pull's schedule and its fire leaves the controller closed by the time we get
      // here — that is readNdjson's cancel-on-every-exit working as intended (see
      // ndjson.test.ts's own `stream()` helper), not a bug, so swallow it.
      return new Promise<void>((r) => setTimeout(() => { try { controller.enqueue(enc.encode(line)); } catch { /* cancelled mid-flight */ } r(); }, delayMs));
    },
  });
}

function setup(opts: { engine?: EngineStreamResult | Error; principal?: Principal; timeoutMs?: number } = {}) {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-s-")), "t.sqlite3"));
  const deps: StreamDeps = {
    db,
    config: getConfig({ AUTH_MODE: "none", ENGINE_URL: "http://e", ENGINE_SECRET: "s", MAKOR_MASTER_KEY: masterKey.toString("base64"), DATA_DIR: "/x", TRIAL_DOCS: "5", ENGINE_TIMEOUT_MS: String(opts.timeoutMs ?? 600000) }),
    masterKey,
    principal: async () => opts.principal ?? { userId: "local", apiKeyId: null, via: "session" },
    engineStream: async () => {
      if (opts.engine instanceof Error) throw opts.engine;
      return opts.engine ?? { status: 200, stream: lines([{ type: "page", seq: 1, t: 0, width: 10, height: 10 }, { type: "done", seq: 2, t: 9, result }]), body: null, retryAfter: null };
    },
    now: () => new Date("2026-09-12T12:00:00Z"),
  };
  return { db, deps };
}
function request(file: Blob | null = new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" })) {
  const form = new FormData();
  if (file) form.append("file", file, "doc.png");
  return new Request("http://x/api/extract/stream", { method: "POST", body: form });
}
async function events(res: Response) {
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("handleExtractStream", () => {
  it("is session-only", async () => {
    const { deps } = setup({ principal: { userId: "u", apiKeyId: "k", via: "api" } });
    const res = await handleExtractStream(request(), deps);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("SESSION_REQUIRED");
  });
  it("returns a pre-engine rejection as the plain HTTP response", async () => {
    const { db, deps } = setup();
    const res = await handleExtractStream(request(null), deps);
    expect(res.status).toBe(400);
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 400, errorCode: "NO_FILE" });
  });
  it("streams the engine's lines and rewrites done into the API response, finishing the row once", async () => {
    const { db, deps } = setup();
    db.insert(userSettings).values({ userId: "local", storeResults: true, updatedAt: "x" }).run();
    const res = await handleExtractStream(request(), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = await events(res);
    expect(out.map((e) => e.type)).toEqual(["page", "done"]);
    // The rewritten `done` line carries the engine's own seq/t (here 2/9, from the stream
    // fixture in `setup()`) rather than dropping them, so the client's timings stay on the
    // engine's one monotonic clock instead of computing a merge duration off `undefined`.
    expect(out[1]).toMatchObject({ seq: 2, t: 9 });
    expect(out[1].result.usage).toBeUndefined();
    expect(out[1].result.meta).toMatchObject({ mode: "local", backend: "anthropic", model: "claude-opus-5" });
    const rows = db.select().from(documents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 200, docType: "teudat_zehut", tokensIn: 100, tokensOut: 40 });
    expect(JSON.parse(decrypt(rows[0].resultEnc!, masterKey)).document_type).toBe("teudat_zehut");
  });
  it("turns a non-200 engine status into one error line", async () => {
    const { db, deps } = setup({ engine: { status: 502, stream: null, body: { detail: { anthropic_status: 401 } }, retryAfter: null } });
    const res = await handleExtractStream(request(), deps);
    expect(res.status).toBe(200);
    expect(await events(res)).toEqual([{ type: "error", error: "ANTHROPIC_KEY_INVALID", detail: "Anthropic rejected the API key saved in settings" }]);
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 400, errorCode: "ANTHROPIC_KEY_INVALID" });
  });
  it("maps an engine error line and finishes the row with its status", async () => {
    const { db, deps } = setup({ engine: { status: 200, stream: lines([{ type: "regions", seq: 1, t: 1, regions: [] }, { type: "error", seq: 2, t: 2, status: 422, detail: "refused" }]), body: null, retryAfter: null } });
    const out = await events(await handleExtractStream(request(), deps));
    expect(out.map((e) => e.type)).toEqual(["regions", "error"]);
    expect(out[1]).toMatchObject({ error: "ENGINE_ERROR", detail: "refused" });
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 422, errorCode: "ENGINE_ERROR" });
  });
  it("treats a stream that ends without done as a 502", async () => {
    const { db, deps } = setup({ engine: { status: 200, stream: lines([{ type: "page", seq: 1, t: 0, width: 1, height: 1 }]), body: null, retryAfter: null } });
    const out = await events(await handleExtractStream(request(), deps));
    expect(out.at(-1)).toMatchObject({ type: "error", error: "ENGINE_ERROR" });
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 502, errorCode: "ENGINE_ERROR" });
  });
  it("times out on silence between lines as ENGINE_TIMEOUT", async () => {
    const { db, deps } = setup({ timeoutMs: 40, engine: { status: 200, stream: lines([{ type: "page", seq: 1, t: 0, width: 1, height: 1 }, { type: "done", seq: 2, t: 1, result }], 120), body: null, retryAfter: null } });
    const out = await events(await handleExtractStream(request(), deps));
    expect(out.at(-1)).toMatchObject({ type: "error", error: "ENGINE_TIMEOUT" });
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 504, errorCode: "ENGINE_TIMEOUT" });
  });
  it("reports an unreachable engine as one error line", async () => {
    const { db, deps } = setup({ engine: new EngineUnavailable("down") });
    expect(await events(await handleExtractStream(request(), deps))).toEqual([{ type: "error", error: "ENGINE_UNAVAILABLE", detail: "Extraction engine unreachable, retry later" }]);
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 503 });
  });
  it("finishes the row even when the client cancels the response mid-stream", async () => {
    const { db, deps } = setup({ engine: { status: 200, stream: lines([{ type: "page", seq: 1, t: 0, width: 1, height: 1 }, { type: "done", seq: 2, t: 1, result }], 30), body: null, retryAfter: null } });
    const res = await handleExtractStream(request(), deps);
    await res.body!.cancel();
    await new Promise((r) => setTimeout(r, 150));
    expect(db.select().from(documents).all()[0]).toMatchObject({ status: 200, docType: "teudat_zehut" });
  });
  it("stops at the first terminal event: a second terminal line neither reaches the client nor re-finishes the row", async () => {
    const { db, deps } = setup({ engine: { status: 200, stream: lines([{ type: "done", seq: 1, t: 1, result }, { type: "error", seq: 2, t: 2, status: 422, detail: "should never surface" }]), body: null, retryAfter: null } });
    const out = await events(await handleExtractStream(request(), deps));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("done");
    expect(out[0].result.document_type).toBe("teudat_zehut");
    const rows = db.select().from(documents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 200, docType: "teudat_zehut", tokensIn: 100, tokensOut: 40 });
  });
  it("the rewritten done line carries the registries result", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, deps } = setup();
    deps.registriesDb = () => { throw new Error("unavailable"); };
    db.insert(userSettings).values({ userId: "local", checkRegistries: true, updatedAt: "x" }).run();
    const out = await events(await handleExtractStream(request(), deps));
    expect(out.at(-1)).toMatchObject({ type: "done", result: { registries: { error: "REGISTRIES_UNAVAILABLE" } } });
    errorSpy.mockRestore();
  });
  it("honours check_registries=true in the form even with the setting off", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = setup();
    deps.registriesDb = () => { throw new Error("unavailable"); };
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "doc.png");
    form.append("check_registries", "true");
    const out = await events(await handleExtractStream(new Request("http://x/api/extract/stream", { method: "POST", body: form }), deps));
    expect(out.at(-1)).toMatchObject({ type: "done", result: { registries: { error: "REGISTRIES_UNAVAILABLE" } } });
    errorSpy.mockRestore();
  });
});
