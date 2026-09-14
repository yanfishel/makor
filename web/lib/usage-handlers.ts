import { AuthError, type Principal } from "@/lib/auth";
import type { Config } from "@/lib/config";
import { decrypt } from "@/lib/crypto";
import type { Db } from "@/lib/db";
import { deleteAllResults, deleteDocumentResult, getDocumentResult, listDocuments, pendingWindowMs, trialUsed, usageSummary } from "@/lib/documents";
import { apiError, json } from "@/lib/http";
import type { ClerkAdminPort } from "@/lib/invitations";
import { decideMode } from "@/lib/mode";
import type { RegistriesDb } from "@/lib/registries/db";
import { getSettings } from "@/lib/settings";
import { getUser, isUnlimited } from "@/lib/users";
import type { RateLimiter } from "@/lib/rate-limit";

export interface ReadDeps { db: Db; config: Config; masterKey: Buffer; principal: (req: Request) => Promise<Principal>; now?: () => Date;
  /** Opened only when an extraction's owner has check_registries on. */
  registriesDb?: () => RegistriesDb;
  /** The /api/v1/* request budget (`readDeps()` passes the process's one); absent = no limit. */
  limiter?: RateLimiter;
  /** Clerk's admin calls (invitations, account deletion); absent in none mode. */
  clerkAdmin?: ClerkAdminPort }

export async function withPrincipal(request: Request, deps: { principal: ReadDeps["principal"] }, fn: (p: Principal) => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn(await deps.principal(request));
  } catch (err) {
    if (err instanceof AuthError) return apiError(err.status, err.code, err.message);
    throw err;
  }
}

/** Which per-minute budget a /api/v1 request spends: the registries search has its own, lower one. */
export type ApiBucket = "api" | "search";

/** A 429 when `principal` has spent `bucket`'s budget, else null — after authentication, so a bad token spends nothing. */
export function rateLimited(deps: ReadDeps, principal: Principal, bucket: ApiBucket): Response | null {
  const limit = bucket === "search" ? deps.config.apiSearchRateLimitPerMin : deps.config.apiRateLimitPerMin;
  if (!deps.limiter || limit === 0) return null;
  const who = principal.apiKeyId ? `key:${principal.apiKeyId}` : `user:${principal.userId}`;
  const taken = deps.limiter.take(`${bucket}:${who}`, limit);
  if (taken.ok) return null;
  return json(429, { error: "RATE_LIMITED", detail: `At most ${limit} requests a minute — retry in ${taken.retryAfterSec} s`, retry_after: taken.retryAfterSec }, { "Retry-After": String(taken.retryAfterSec) });
}

/** withPrincipal for a /api/v1 route: the principal, then its request budget, then the handler. */
export function withApiPrincipal(request: Request, deps: ReadDeps, bucket: ApiBucket, fn: (p: Principal) => Promise<Response> | Response): Promise<Response> {
  return withPrincipal(request, deps, (p) => rateLimited(deps, p, bucket) ?? fn(p));
}

export function currentMode(deps: ReadDeps, userId: string) {
  const now = (deps.now ?? (() => new Date()))();
  const settings = getSettings(deps.db, userId);
  const used = trialUsed(deps.db, userId, now, pendingWindowMs(deps.config.engineTimeoutMs));
  const unlimited = isUnlimited(getUser(deps.db, userId));
  const decided = decideMode({ authMode: deps.config.authMode, hasByokKey: Boolean(settings.anthropicKeyEnc), trialUsed: used, trialDocs: deps.config.trialDocs, unlimited });
  const mode = decided === "exhausted" ? "trial" : decided;
  return { settings, used, mode, unlimited, remaining: mode === "trial" && !unlimited ? Math.max(deps.config.trialDocs - used, 0) : null, now };
}

export const handleUsage = (request: Request, deps: ReadDeps) => withApiPrincipal(request, deps, "api", (p) => {
  const { settings, used, mode, unlimited, remaining, now } = currentMode(deps, p.userId);
  const s = usageSummary(deps.db, p.userId, pendingWindowMs(deps.config.engineTimeoutMs), now);
  return json(200, { mode, trial_docs: deps.config.trialDocs, trial_used: used, trial_remaining: remaining, unlimited, byok: Boolean(settings.anthropicKeyEnc),
    month: s.month, docs_this_month: s.docsThisMonth, ok_this_month: s.okThisMonth, failed_this_month: s.failedThisMonth, total: s.total });
});

export const handleListDocuments = (request: Request, deps: ReadDeps) => withApiPrincipal(request, deps, "api", (p) => {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return json(200, listDocuments(deps.db, p.userId, { limit: Number.isFinite(limit) ? limit : 50, offset: Number.isFinite(offset) ? offset : 0 }));
});

export const handleGetDocument = (request: Request, id: string, deps: ReadDeps) => withApiPrincipal(request, deps, "api", (p) => {
  const { found, resultEnc } = getDocumentResult(deps.db, p.userId, id);
  if (!found) return apiError(404, "NOT_FOUND");
  if (!resultEnc) return apiError(404, "NOT_STORED", "This document's result was not stored (see settings → store results)");
  try {
    return new Response(decrypt(resultEnc, deps.masterKey), { status: 200, headers: { "content-type": "application/json" } });
  } catch {
    return apiError(500, "KEY_DECRYPT_FAILED", "Stored result cannot be decrypted — the master key changed");
  }
});

export const handleDeleteDocument = (request: Request, id: string, deps: ReadDeps) => withApiPrincipal(request, deps, "api", (p) =>
  deleteDocumentResult(deps.db, p.userId, id) ? new Response(null, { status: 204 }) : apiError(404, "NOT_FOUND"));

export const handleDeleteAllResults = (request: Request, deps: ReadDeps) => withApiPrincipal(request, deps, "api", (p) =>
  json(200, { deleted: deleteAllResults(deps.db, p.userId) }));
