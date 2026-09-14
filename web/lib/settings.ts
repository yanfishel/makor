import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { userSettings, type UserSettingsRow } from "@/lib/db/schema";
import type { AuthMode } from "@/lib/config";

const DEFAULTS: Omit<UserSettingsRow, "userId"> = { storeResults: false, anthropicKeyEnc: null, anthropicKeyLast4: null, model: null, backend: null, localModel: null, checkRegistries: false, updatedAt: "" };

/** Per-user settings row, defaulted (store off, no key/backend/model override) when none exists yet. */
export function getSettings(db: Db, userId: string): UserSettingsRow {
  return db.select().from(userSettings).where(eq(userSettings.userId, userId)).get() ?? { userId, ...DEFAULTS };
}

export const MODEL_CHOICES = [
  { id: "claude-opus-5", label: "Claude Opus 5", recommended: true },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", recommended: false },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", recommended: false },
] as const;
export const DEFAULT_CLOUD_MODEL = "claude-opus-5";
export const isAllowedCloudModel = (id: string) => MODEL_CHOICES.some((m) => m.id === id);

function upsert(db: Db, userId: string, patch: Partial<Omit<UserSettingsRow, "userId">>, now: Date): UserSettingsRow {
  const current = getSettings(db, userId);
  const next = { ...current, ...patch, userId, updatedAt: now.toISOString() };
  db.insert(userSettings).values(next).onConflictDoUpdate({ target: userSettings.userId, set: next }).run();
  return next;
}

/** Merges only the given fields; unset ones keep their stored value (or the default on first write). */
export function updateSettings(db: Db, userId: string, patch: { storeResults?: boolean; model?: string | null; backend?: "ollama" | "anthropic" | null; localModel?: string | null; checkRegistries?: boolean }, now: Date = new Date()): UserSettingsRow {
  return upsert(db, userId, patch, now);
}
export function setAnthropicKey(db: Db, userId: string, keyEnc: string, last4: string, now: Date = new Date()): void {
  upsert(db, userId, { anthropicKeyEnc: keyEnc, anthropicKeyLast4: last4 }, now);
}
export function clearAnthropicKey(db: Db, userId: string, now: Date = new Date()): void {
  upsert(db, userId, { anthropicKeyEnc: null, anthropicKeyLast4: null }, now);
}

export type KeyVerdict = "valid" | "invalid" | "unreachable";
/** One cheap authenticated call; the key is never stored unless this says valid. */
export async function verifyAnthropicKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 200) return "valid";
    if (res.status === 401 || res.status === 403) return "invalid";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

export interface PublicSettings { store_results: boolean; check_registries: boolean; model: string | null; local_model: string | null; backend: string | null; anthropic_key_last4: string | null; has_anthropic_key: boolean; model_choices: typeof MODEL_CHOICES; default_model: string }
/** Never includes the encrypted key. In clerk mode the backend selector and the local model are not applicable — always null. */
export function publicSettings(row: UserSettingsRow, authMode: AuthMode): PublicSettings {
  return {
    store_results: row.storeResults,
    check_registries: row.checkRegistries,
    model: row.model,
    local_model: authMode === "clerk" ? null : row.localModel,
    backend: authMode === "clerk" ? null : row.backend,
    anthropic_key_last4: row.anthropicKeyLast4,
    has_anthropic_key: Boolean(row.anthropicKeyEnc),
    model_choices: MODEL_CHOICES,
    default_model: DEFAULT_CLOUD_MODEL,
  };
}

/** What /api/v1/settings shows a key: the public settings without the Anthropic key's traces — that key is managed from the signed-in UI only. */
export type ApiSettings = Omit<PublicSettings, "anthropic_key_last4" | "has_anthropic_key">;
export function apiSettings(row: UserSettingsRow, authMode: AuthMode): ApiSettings {
  const s = publicSettings(row, authMode);
  return { store_results: s.store_results, check_registries: s.check_registries, backend: s.backend, model: s.model, local_model: s.local_model, model_choices: s.model_choices, default_model: s.default_model };
}
