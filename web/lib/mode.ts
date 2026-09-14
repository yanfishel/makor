import type { AuthMode } from "@/lib/config";

export type Mode = "local" | "byok" | "trial";

/**
 * Spec §2: none → local; key → byok; trial left → trial; otherwise exhausted.
 * `unlimited` (an admin, or a user an admin exempted) keeps the trial open on the server's key.
 */
export function decideMode(input: { authMode: AuthMode; hasByokKey: boolean; trialUsed: number; trialDocs: number; unlimited?: boolean }): Mode | "exhausted" {
  if (input.authMode === "none") return "local";
  if (input.hasByokKey) return "byok";
  if (input.unlimited) return "trial";
  return input.trialUsed < input.trialDocs ? "trial" : "exhausted";
}
