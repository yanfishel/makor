import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { decrypt } from "@/lib/crypto";
import { getSettings, updateSettings } from "@/lib/settings";
import type { Principal } from "@/lib/auth";
import { RateLimiter } from "@/lib/rate-limit";
import { handleApiGetSettings, handleApiPatchSettings, handleDeleteAnthropicKey, handleEngineHealth, handleEngineModels, handleGetSettings, handlePutAnthropicKey, handlePutSettings, type SettingsDeps } from "@/lib/settings-handlers";

const masterKey = randomBytes(32);
const session: Principal = { userId: "u1", apiKeyId: null, via: "session" };
function setup(authMode: "clerk" | "none", fetchStatus = 200) {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-sh-")), "t.sqlite3"));
  const calls: { url: string; init?: RequestInit }[] = [];
  const deps: SettingsDeps = {
    db, masterKey, principal: async () => session,
    config: getConfig({ AUTH_MODE: authMode, ENGINE_URL: "http://e", ENGINE_SECRET: "s", MAKOR_MASTER_KEY: masterKey.toString("base64"), DATA_DIR: "/x", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y" }),
    fetchImpl: (async (url: string, init?: RequestInit) => (calls.push({ url: String(url), init }), new Response(
      String(url).includes("healthz") ? JSON.stringify({ backend: "ollama", model: "m", queue: {} })
      : String(url).includes("/models") ? JSON.stringify({ backend: "ollama", default_local: "qwen3-vl:8b-instruct", default_cloud: "claude-opus-5", ollama_reachable: true, models: [{ id: "qwen3-vl:8b-instruct", label: "Qwen3-VL 8B", note: "n", installed: true }] })
      : "{}", { status: fetchStatus }))) as unknown as typeof fetch,
  };
  return { db, deps, calls };
}
const put = (url: string, body: unknown) => new Request(`http://x${url}`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("settings handlers", () => {
  it("clerk mode: model allow-list enforced, backend ignored", async () => {
    const { deps } = setup("clerk");
    expect((await handlePutSettings(put("/api/settings", { model: "gpt-9" }), deps)).status).toBe(400);
    const ok = await (await handlePutSettings(put("/api/settings", { model: "claude-sonnet-5", backend: "ollama", store_results: true }), deps)).json();
    expect(ok).toMatchObject({ model: "claude-sonnet-5", backend: null, store_results: true });
  });
  it("none mode: backend accepted", async () => {
    const { deps } = setup("none");
    const ok = await (await handlePutSettings(put("/api/settings", { backend: "anthropic" }), deps)).json();
    expect(ok.backend).toBe("anthropic");
    expect((await handlePutSettings(put("/api/settings", { backend: "magic" }), deps)).status).toBe(400);
  });
  it("stores a verified key encrypted, deletes it", async () => {
    const { db, deps } = setup("clerk");
    const res = await handlePutAnthropicKey(put("/api/settings/anthropic-key", { key: "sk-ant-api03-abcdef" }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ has_anthropic_key: true, anthropic_key_last4: "cdef" });
    expect(decrypt(getSettings(db, "u1").anthropicKeyEnc!, masterKey)).toBe("sk-ant-api03-abcdef");
    expect((await (await handleDeleteAnthropicKey(new Request("http://x", { method: "DELETE" }), deps)).json()).has_anthropic_key).toBe(false);
  });
  it("rejects an invalid key and reports unreachable", async () => {
    expect((await (await handlePutAnthropicKey(put("/x", { key: "sk-ant-bad" }), setup("clerk", 401).deps)).json()).error).toBe("ANTHROPIC_KEY_INVALID");
    expect((await handlePutAnthropicKey(put("/x", { key: "sk-ant-bad" }), setup("clerk", 503).deps)).status).toBe(502);
    expect((await handlePutAnthropicKey(put("/x", { key: "" }), setup("clerk").deps)).status).toBe(400);
  });
  it("engine health passthrough and GET settings shape", async () => {
    const { deps } = setup("none");
    expect(await (await handleEngineHealth(new Request("http://x"), deps)).json()).toMatchObject({ backend: "ollama" });
    expect(await (await handleGetSettings(new Request("http://x"), deps)).json()).toMatchObject({ has_anthropic_key: false, default_model: "claude-opus-5" });
  });
  it("none mode: local_model accepted, cleared with null, rejected when not a string", async () => {
    const { deps } = setup("none");
    expect((await (await handlePutSettings(put("/api/settings", { local_model: "qwen3-vl:30b-a3b-instruct" }), deps)).json()).local_model).toBe("qwen3-vl:30b-a3b-instruct");
    expect((await (await handlePutSettings(put("/api/settings", { local_model: null }), deps)).json()).local_model).toBeNull();
    expect((await handlePutSettings(put("/api/settings", { local_model: 7 }), deps)).status).toBe(400);
    expect((await handlePutSettings(put("/api/settings", { local_model: "" }), deps)).status).toBe(400);
  });
  it("clerk mode: local_model ignored", async () => {
    const { deps } = setup("clerk");
    expect((await (await handlePutSettings(put("/api/settings", { local_model: "qwen3-vl:30b-a3b-instruct" }), deps)).json()).local_model).toBeNull();
  });
  it("engine models passthrough, 503 when the engine is down", async () => {
    const { deps } = setup("none");
    const body = await (await handleEngineModels(new Request("http://x"), deps)).json();
    expect(body.models[0]).toMatchObject({ id: "qwen3-vl:8b-instruct", installed: true });
    expect((await handleEngineModels(new Request("http://x"), setup("none", 500).deps)).status).toBe(503);
  });
  it("engine models sends the engine secret", async () => {
    // The engine refuses an unauthenticated /models with 401 whenever MAKOR_ENGINE_SECRET
    // is set, which the web app would surface as ENGINE_UNAVAILABLE — a header this handler
    // forgot to send would look exactly like an engine that is down.
    const { deps, calls } = setup("none");
    await handleEngineModels(new Request("http://x"), deps);
    const call = calls.find((c) => c.url.includes("/models"));
    expect(call).toBeDefined();
    expect((call!.init?.headers as Record<string, string>)["X-Engine-Secret"]).toBe("s");
  });
  it("check_registries: off by default, a boolean turns it on and off, anything else is 400", async () => {
    const { deps } = setup("clerk");
    expect((await (await handleGetSettings(new Request("http://x/api/settings"), deps)).json()).check_registries).toBe(false);
    expect((await (await handlePutSettings(put("/api/settings", { check_registries: true }), deps)).json()).check_registries).toBe(true);
    expect(getSettings(deps.db, "u1").checkRegistries).toBe(true);
    expect((await (await handlePutSettings(put("/api/settings", { check_registries: false }), deps)).json()).check_registries).toBe(false);
    const bad = await handlePutSettings(put("/api/settings", { check_registries: "yes" }), deps);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("INVALID_BODY");
  });
});

describe("/api/v1/settings", () => {
  const viaKey: Principal = { userId: "u1", apiKeyId: "k1", via: "api" };
  const keyed = (authMode: "clerk" | "none") => {
    const s = setup(authMode);
    s.deps.principal = async () => viaKey;
    return s;
  };
  const patch = (body: unknown) => new Request("http://x/api/v1/settings", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("GET with an API key shows the five settings and the model choices, never the Anthropic key", async () => {
    const { deps } = keyed("clerk");
    const res = await handleApiGetSettings(new Request("http://x/api/v1/settings"), deps);
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["backend", "check_registries", "default_model", "local_model", "model", "model_choices", "store_results"]);
  });

  it("PATCH with an API key changes check_registries and turns store_results off, answering the same shape", async () => {
    const { db, deps } = keyed("clerk");
    updateSettings(db, "u1", { storeResults: true });
    const res = await handleApiPatchSettings(patch({ check_registries: true, store_results: false }), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ check_registries: true, store_results: false });
    expect(body).not.toHaveProperty("has_anthropic_key");
    expect(getSettings(deps.db, "u1")).toMatchObject({ checkRegistries: true, storeResults: false });
  });

  it("a key may echo store_results: true while it is already on (a GET-modify-PATCH client)", async () => {
    const { db, deps } = keyed("clerk");
    updateSettings(db, "u1", { storeResults: true });
    const res = await handleApiPatchSettings(patch({ store_results: true, check_registries: true }), deps);
    expect(res.status).toBe(200);
    expect(getSettings(db, "u1")).toMatchObject({ storeResults: true, checkRegistries: true });
  });

  it("a key cannot turn store_results on: 403 SESSION_REQUIRED and nothing in the body is applied; a session can", async () => {
    const { deps } = keyed("clerk");
    const res = await handleApiPatchSettings(patch({ store_results: true, check_registries: true }), deps);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("SESSION_REQUIRED");
    expect(getSettings(deps.db, "u1")).toMatchObject({ storeResults: false, checkRegistries: false });
    const { deps: sessionDeps } = setup("clerk");
    expect((await (await handleApiPatchSettings(patch({ store_results: true }), sessionDeps)).json()).store_results).toBe(true);
  });

  it("PATCH applies the settings page's rules: the cloud allow-list, backend only in none mode, a JSON object only", async () => {
    const { deps } = keyed("clerk");
    expect((await (await handleApiPatchSettings(patch({ model: "gpt-9" }), deps)).json()).error).toBe("INVALID_MODEL");
    expect(await (await handleApiPatchSettings(patch({ model: "claude-sonnet-5", backend: "ollama" }), deps)).json()).toMatchObject({ model: "claude-sonnet-5", backend: null });
    expect((await handleApiPatchSettings(patch([1, 2]), deps)).status).toBe(400);
    expect((await handleApiPatchSettings(patch({ check_registries: "yes" }), deps)).status).toBe(400);
    const local = keyed("none");
    expect(await (await handleApiPatchSettings(patch({ backend: "ollama", local_model: "qwen3-vl:8b-instruct" }), local.deps)).json()).toMatchObject({ backend: "ollama", local_model: "qwen3-vl:8b-instruct" });
  });

  it("GET and PATCH spend the key's /api/v1 budget", async () => {
    const { deps } = keyed("clerk");
    deps.limiter = new RateLimiter(() => 0);
    deps.config = { ...deps.config, apiRateLimitPerMin: 1 };
    expect((await handleApiGetSettings(new Request("http://x/api/v1/settings"), deps)).status).toBe(200);
    const refused = await handleApiPatchSettings(patch({ check_registries: true }), deps);
    expect(refused.status).toBe(429);
    expect(getSettings(deps.db, "u1").checkRegistries).toBe(false);
  });

  it("the settings page's own routes still refuse a key", async () => {
    const { deps } = keyed("clerk");
    expect((await (await handleGetSettings(new Request("http://x/api/settings"), deps)).json()).error).toBe("SESSION_REQUIRED");
    expect((await (await handlePutSettings(put("/api/settings", { store_results: true }), deps)).json()).error).toBe("SESSION_REQUIRED");
  });
});
