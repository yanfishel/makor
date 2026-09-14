import type { Principal } from "@/lib/auth";
import { activeKeyCount, createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys";
import { apiError, json, readJson } from "@/lib/http";
import { withPrincipal, type ReadDeps } from "@/lib/usage-handlers";

export const MAX_ACTIVE_KEYS = 20;

/** Keys and settings are managed from the signed-in UI only — never with another API key. */
export function requireSession(request: Request, deps: { principal: ReadDeps["principal"] }, fn: (p: Principal) => Promise<Response> | Response) {
  return withPrincipal(request, deps, (p) => (p.via === "api" ? apiError(403, "SESSION_REQUIRED", "Sign in to use this endpoint") : fn(p)));
}

export const handleListKeys = (request: Request, deps: ReadDeps) => requireSession(request, deps, (p) => json(200, { keys: listApiKeys(deps.db, p.userId) }));

export const handleCreateKey = (request: Request, deps: ReadDeps) => requireSession(request, deps, async (p) => {
  const body = await readJson<{ name?: unknown }>(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64) return apiError(400, "INVALID_NAME", "name must be 1–64 characters");
  if (activeKeyCount(deps.db, p.userId) >= MAX_ACTIVE_KEYS) return apiError(409, "KEY_LIMIT", `at most ${MAX_ACTIVE_KEYS} active keys`);
  return json(201, createApiKey(deps.db, p.userId, name, (deps.now ?? (() => new Date()))()));
});

export const handleRevokeKey = (request: Request, id: string, deps: ReadDeps) => requireSession(request, deps, (p) =>
  revokeApiKey(deps.db, p.userId, id, (deps.now ?? (() => new Date()))()) ? new Response(null, { status: 204 }) : apiError(404, "NOT_FOUND"));
