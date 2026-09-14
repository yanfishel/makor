import { parseRefreshAt, type RefreshAt } from "@/lib/registries/refresh-time";

export type AuthMode = "clerk" | "none";

export interface Config {
  authMode: AuthMode;
  engineUrl: string;
  engineSecret: string;
  engineTimeoutMs: number;
  dataDir: string;
  masterKeyB64: string | null;
  trialDocs: number;
  siteUrl: string;
  clerkPublishableKey: string | null;
  clerkSecretKey: string | null;
  /** MAKOR_ADMIN_EMAIL, lower-cased: in clerk mode this address is invited while the instance has no admin, and admitted as admin. */
  adminEmail: string | null;
  /** Requests per minute per API key (per user for a session) on /api/v1/* other than the registries search; 0 = no limit. */
  apiRateLimitPerMin: number;
  /** The same for GET /api/v1/registries/search — cheap for the caller, a synchronous FTS query per source for the one Node process; 0 = no limit. */
  apiSearchRateLimitPerMin: number;
  /** MAKOR_REGISTRIES_REFRESH_AT, Israeli time: when the registries refresh by themselves every day; null = only by hand. */
  registriesRefreshAt: RefreshAt | null;
}

function perMinute(env: Partial<NodeJS.ProcessEnv>, name: string, fallback: number): number {
  // Blank counts as unset — `run.sh` sources .env, where `NAME=` would otherwise read as 0 (no limit) while compose's `${NAME:-30}` reads the default.
  const raw = env[name]?.trim() || String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return value;
}

/**
 * Read and validate the environment. Pure so tests can pass their own env — Partial<>
 * because every key this reads is optional, while NodeJS.ProcessEnv requires NODE_ENV.
 */
export function getConfig(env: Partial<NodeJS.ProcessEnv> = process.env): Config {
  const authMode = (env.AUTH_MODE ?? "none").trim();
  if (authMode !== "clerk" && authMode !== "none") {
    throw new Error(`AUTH_MODE must be "clerk" or "none", got "${authMode}"`);
  }
  const engineSecret = (env.ENGINE_SECRET ?? "").trim();
  const masterKeyB64 = (env.MAKOR_MASTER_KEY ?? "").trim() || null;
  const clerkPublishableKey = (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").trim() || null;
  const clerkSecretKey = (env.CLERK_SECRET_KEY ?? "").trim() || null;
  if (authMode === "clerk") {
    if (!masterKeyB64) throw new Error("AUTH_MODE=clerk requires MAKOR_MASTER_KEY");
    if (!engineSecret) throw new Error("AUTH_MODE=clerk requires ENGINE_SECRET");
    if (!clerkPublishableKey) throw new Error("AUTH_MODE=clerk requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    if (!clerkSecretKey) throw new Error("AUTH_MODE=clerk requires CLERK_SECRET_KEY");
  }
  const refreshRaw = (env.MAKOR_REGISTRIES_REFRESH_AT ?? "").trim();
  const registriesRefreshAt = refreshRaw ? parseRefreshAt(refreshRaw) : null;
  if (refreshRaw && !registriesRefreshAt) throw new Error(`MAKOR_REGISTRIES_REFRESH_AT must be HH:MM (24-hour, Israeli time) or empty, got "${refreshRaw}"`);
  const trialRaw = (env.TRIAL_DOCS ?? "5").trim();
  const trialDocs = Number(trialRaw);
  if (!Number.isInteger(trialDocs) || trialDocs < 0) throw new Error(`TRIAL_DOCS must be a non-negative integer, got "${trialRaw}"`);
  const engineTimeoutRaw = (env.ENGINE_TIMEOUT_MS ?? "600000").trim();
  const engineTimeoutMs = Number(engineTimeoutRaw);
  if (!Number.isInteger(engineTimeoutMs) || engineTimeoutMs <= 0) throw new Error(`ENGINE_TIMEOUT_MS must be a positive integer, got "${engineTimeoutRaw}"`);
  return {
    authMode,
    engineUrl: (env.ENGINE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, ""),
    engineSecret,
    engineTimeoutMs,
    dataDir: env.DATA_DIR ?? "data",
    masterKeyB64,
    trialDocs,
    siteUrl: (env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    clerkPublishableKey,
    clerkSecretKey,
    adminEmail: (env.MAKOR_ADMIN_EMAIL ?? "").trim().toLowerCase() || null,
    apiRateLimitPerMin: perMinute(env, "API_RATE_LIMIT_PER_MIN", 30),
    apiSearchRateLimitPerMin: perMinute(env, "API_SEARCH_RATE_LIMIT_PER_MIN", 20),
    registriesRefreshAt,
  };
}
