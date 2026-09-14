import type { AuthMode } from "@/lib/config";
import { encrypt } from "@/lib/crypto";
import type { EngineModels } from "@/lib/engine";
import { apiError, json, readJson } from "@/lib/http";
import { requireSession } from "@/lib/keys-handlers";
import { apiSettings, clearAnthropicKey, getSettings, isAllowedCloudModel, publicSettings, setAnthropicKey, updateSettings, verifyAnthropicKey } from "@/lib/settings";
import { withApiPrincipal, type ReadDeps } from "@/lib/usage-handlers";

export interface SettingsDeps extends ReadDeps { fetchImpl?: typeof fetch }
const now = (d: ReadDeps) => (d.now ?? (() => new Date()))();

export const handleGetSettings = (request: Request, deps: SettingsDeps) => requireSession(request, deps, (p) =>
  json(200, publicSettings(getSettings(deps.db, p.userId), deps.config.authMode)));

export type SettingsPatch = Parameters<typeof updateSettings>[2];

/** The five fields a user sets — store_results, check_registries, model, backend, local_model —
 * validated the one way the settings page and /api/v1/settings share. backend and local_model
 * apply in none mode only; in clerk mode they are ignored and model must be a listed choice. */
export function settingsPatch(body: unknown, authMode: AuthMode): { patch: SettingsPatch; error?: undefined } | { error: Response; patch?: undefined } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: apiError(400, "INVALID_BODY") };
  const b = body as { store_results?: unknown; check_registries?: unknown; model?: unknown; backend?: unknown; local_model?: unknown };
  const patch: SettingsPatch = {};
  if (b.store_results !== undefined) {
    if (typeof b.store_results !== "boolean") return { error: apiError(400, "INVALID_BODY", "store_results must be boolean") };
    patch.storeResults = b.store_results;
  }
  if (b.check_registries !== undefined) {
    if (typeof b.check_registries !== "boolean") return { error: apiError(400, "INVALID_BODY", "check_registries must be boolean") };
    patch.checkRegistries = b.check_registries;
  }
  if (b.model !== undefined) {
    if (b.model !== null && typeof b.model !== "string") return { error: apiError(400, "INVALID_BODY", "model must be a string or null") };
    if (authMode === "clerk" && b.model !== null && !isAllowedCloudModel(b.model)) return { error: apiError(400, "INVALID_MODEL", "choose a model from model_choices") };
    patch.model = b.model;
  }
  if (b.backend !== undefined && authMode === "none") {
    if (b.backend !== null && b.backend !== "ollama" && b.backend !== "anthropic") return { error: apiError(400, "INVALID_BODY", "backend must be ollama, anthropic or null") };
    patch.backend = b.backend;
  }
  if (b.local_model !== undefined && authMode === "none") {
    if (b.local_model !== null && (typeof b.local_model !== "string" || !b.local_model.trim())) return { error: apiError(400, "INVALID_BODY", "local_model must be a non-empty string or null") };
    // Any tag is accepted: the UI offers only the engine's allow-list, and an unpulled tag
    // fails at extraction with the engine's own "ollama pull …" message.
    patch.localModel = b.local_model;
  }
  return { patch };
}

export const handlePutSettings = (request: Request, deps: SettingsDeps) => requireSession(request, deps, async (p) => {
  const parsed = settingsPatch(await readJson(request), deps.config.authMode);
  if (parsed.error) return parsed.error;
  return json(200, publicSettings(updateSettings(deps.db, p.userId, parsed.patch, now(deps)), deps.config.authMode));
});

/** GET /api/v1/settings — the five user settings and the model choices, for a key or a session. */
export const handleApiGetSettings = (request: Request, deps: SettingsDeps) => withApiPrincipal(request, deps, "api", (p) =>
  json(200, apiSettings(getSettings(deps.db, p.userId), deps.config.authMode)));

/** PATCH /api/v1/settings — the settings page's own rules (settingsPatch); the Anthropic key and API keys stay session-only.
 * A key may turn store_results off but never on: a leaked key must not be able to start keeping
 * the owner's results and then read them back through /api/v1/documents. */
export const handleApiPatchSettings = (request: Request, deps: SettingsDeps) => withApiPrincipal(request, deps, "api", async (p) => {
  const parsed = settingsPatch(await readJson(request), deps.config.authMode);
  if (parsed.error) return parsed.error;
  // Only a change from off to on is refused: a client that GETs the settings, edits one field and PATCHes the body back echoes store_results as it is.
  if (p.via === "api" && parsed.patch.storeResults === true && !getSettings(deps.db, p.userId).storeResults) {
    return apiError(403, "SESSION_REQUIRED", "Turning store_results on requires the signed-in UI; a key can only turn it off");
  }
  return json(200, apiSettings(updateSettings(deps.db, p.userId, parsed.patch, now(deps)), deps.config.authMode));
});

export const handlePutAnthropicKey = (request: Request, deps: SettingsDeps) => requireSession(request, deps, async (p) => {
  const body = await readJson<{ key?: unknown }>(request);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) return apiError(400, "INVALID_BODY", "key required");
  const verdict = await verifyAnthropicKey(key, deps.fetchImpl);
  if (verdict === "invalid") return apiError(400, "ANTHROPIC_KEY_INVALID", "Anthropic rejected this key");
  if (verdict === "unreachable") return apiError(502, "ANTHROPIC_UNREACHABLE", "Could not reach the Anthropic API to verify the key");
  setAnthropicKey(deps.db, p.userId, encrypt(key, deps.masterKey), key.slice(-4), now(deps));
  return json(200, publicSettings(getSettings(deps.db, p.userId), deps.config.authMode));
});

export const handleDeleteAnthropicKey = (request: Request, deps: SettingsDeps) => requireSession(request, deps, (p) => {
  clearAnthropicKey(deps.db, p.userId, now(deps));
  return json(200, publicSettings(getSettings(deps.db, p.userId), deps.config.authMode));
});

export const handleVerifyAnthropicKey = (request: Request, deps: SettingsDeps) => requireSession(request, deps, async () => {
  const body = await readJson<{ key?: unknown }>(request);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) return apiError(400, "INVALID_BODY", "key required");
  return json(200, { verdict: await verifyAnthropicKey(key, deps.fetchImpl) });
});

export const handleEngineHealth = (request: Request, deps: SettingsDeps) => requireSession(request, deps, async () => {
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${deps.config.engineUrl}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return apiError(503, "ENGINE_UNAVAILABLE");
    return json(200, await res.json());
  } catch {
    return apiError(503, "ENGINE_UNAVAILABLE");
  }
});

export const handleEngineModels = (request: Request, deps: SettingsDeps) => requireSession(request, deps, async () => {
  try {
    const headers: Record<string, string> = deps.config.engineSecret ? { "X-Engine-Secret": deps.config.engineSecret } : {};
    const res = await (deps.fetchImpl ?? fetch)(`${deps.config.engineUrl}/models`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return apiError(503, "ENGINE_UNAVAILABLE");
    return json(200, (await res.json()) as EngineModels);
  } catch {
    return apiError(503, "ENGINE_UNAVAILABLE");
  }
});
