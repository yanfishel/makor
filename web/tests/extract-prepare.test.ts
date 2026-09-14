import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import { completeExtract, failEngine, failTransport, prepareExtract } from "@/lib/extract-handler";
import { EngineTimeout } from "@/lib/engine";
import type { ReadDeps } from "@/lib/usage-handlers";

const masterKey = randomBytes(32);
const okBody = { document_type: "teudat_zehut", fields: {}, validation: { overall: "unverified" }, warnings: [], regions: [], sefach: null,
  model: "ollama/qwen3-vl:8b-instruct", usage: [] };

function deps(): ReadDeps {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-p-")), "t.sqlite3"));
  return { db, config: getConfig({ AUTH_MODE: "none", ENGINE_URL: "http://e", ENGINE_SECRET: "s", MAKOR_MASTER_KEY: masterKey.toString("base64"), DATA_DIR: "/x", TRIAL_DOCS: "5" }),
    masterKey, principal: async () => ({ userId: "local", apiKeyId: null, via: "session" }), now: () => new Date("2026-09-12T12:00:00Z") };
}
function request(file: Blob | null = new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" })) {
  const form = new FormData();
  if (file) form.append("file", file, "doc.png");
  return new Request("http://x/api/extract/stream", { method: "POST", body: form });
}

describe("prepareExtract", () => {
  it("starts a pending row and hands back the file, overrides and a finish", async () => {
    const d = deps();
    const p = await prepareExtract(request(), d);
    expect(p.reject).toBeUndefined();
    const prep = p.prep!;
    expect(prep.filename).toBe("doc.png");
    expect(prep.mode).toBe("local");
    expect(prep.overrides).toEqual({});
    expect(d.db.select().from(documents).all()[0]).toMatchObject({ id: prep.documentId, status: 102 });
  });
  it("rejects a missing file with a recorded row and no prep", async () => {
    const d = deps();
    const p = await prepareExtract(request(null), d);
    expect(p.prep).toBeUndefined();
    expect(p.reject!.status).toBe(400);
    expect(d.db.select().from(documents).all()[0]).toMatchObject({ status: 400, errorCode: "NO_FILE" });
  });
});

describe("failEngine / failTransport / completeExtract", () => {
  it("maps a rejected Anthropic key and finishes the row at 400", async () => {
    const d = deps();
    const { prep } = await prepareExtract(request(), d);
    const f = failEngine(prep!, { status: 502, body: { detail: { anthropic_status: 401 } }, retryAfter: null });
    expect(f).toMatchObject({ status: 400, error: "ANTHROPIC_KEY_INVALID" });
    expect(d.db.select().from(documents).all()[0]).toMatchObject({ status: 400, errorCode: "ANTHROPIC_KEY_INVALID" });
  });
  it("passes a retry-after through and finishes with the engine's status", async () => {
    const d = deps();
    const { prep } = await prepareExtract(request(), d);
    const f = failEngine(prep!, { status: 503, body: { detail: "busy" }, retryAfter: "30" });
    expect(f).toEqual({ status: 503, error: "ENGINE_ERROR", detail: "busy", headers: { "retry-after": "30" } });
    expect(d.db.select().from(documents).all()[0]).toMatchObject({ status: 503, errorCode: "ENGINE_ERROR" });
  });
  it("maps a timeout to 504 and anything else to 500", async () => {
    const d = deps();
    const { prep } = await prepareExtract(request(), d);
    expect(failTransport(prep!, new EngineTimeout("slow"))).toMatchObject({ status: 504, error: "ENGINE_TIMEOUT" });
    expect(failTransport(prep!, new Error("boom"))).toMatchObject({ status: 500, error: "INTERNAL" });
  });
  it("completes a 200 body into the API response and a finished row", async () => {
    const d = deps();
    const { prep } = await prepareExtract(request(), d);
    const done = completeExtract(d, prep!, okBody);
    expect("response" in done).toBe(true);
    const response = (done as { response: Record<string, unknown> }).response;
    expect(response.usage).toBeUndefined();
    expect(response.meta).toEqual({ mode: "local", trial_remaining: null, backend: "ollama", model: "qwen3-vl:8b-instruct", document_id: prep!.documentId });
    expect(d.db.select().from(documents).all()[0]).toMatchObject({ status: 200, docType: "teudat_zehut", backend: "ollama", costUsd: null });
  });
});
