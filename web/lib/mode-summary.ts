import type { AuthMode } from "@/lib/config";

export type ModeSummary = { kind: "local" } | { kind: "byok" } | { kind: "unlimited" } | { kind: "trial"; left: number; total: number };

/** Same precedence as lib/mode.ts decideMode, reduced to what the UI shows. */
export function modeSummary(i: { authMode: AuthMode; hasKey: boolean; unlimited: boolean; trialDocs: number; trialUsed: number }): ModeSummary {
  if (i.authMode === "none") return { kind: "local" };
  if (i.hasKey) return { kind: "byok" };
  if (i.unlimited) return { kind: "unlimited" };
  return { kind: "trial", left: Math.max(i.trialDocs - i.trialUsed, 0), total: i.trialDocs };
}
