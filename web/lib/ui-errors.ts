/** Error codes the UI has a translated message for; anything else falls back to `errors.generic`. */
export const KNOWN_ERRORS = ["TRIAL_EXHAUSTED", "ANTHROPIC_KEY_INVALID", "ANTHROPIC_UNREACHABLE", "KEY_DECRYPT_FAILED", "ENGINE_UNAVAILABLE", "ENGINE_TIMEOUT", "ENGINE_MISCONFIGURED", "TOO_LARGE", "NOT_IMAGE", "NO_FILE", "UNAUTHENTICATED", "TOKEN_INVALID"] as const;

/** Message key for an API error code, inside whichever namespace the caller translates in. */
export function errorMessageKey(code: string | undefined): string {
  return code && (KNOWN_ERRORS as readonly string[]).includes(code) ? `errors.${code}` : "errors.generic";
}

/** Codes the `settings` namespace has its own message for; everything else falls back to generic. */
export const SETTINGS_ERRORS = ["ANTHROPIC_KEY_INVALID", "ANTHROPIC_UNREACHABLE", "UNAUTHENTICATED"] as const;

/** Like `errorMessageKey`, but limited to the codes `settings.errors` defines. */
export function settingsErrorKey(code: string | undefined): string {
  return code && (SETTINGS_ERRORS as readonly string[]).includes(code) ? `errors.${code}` : "errors.generic";
}
