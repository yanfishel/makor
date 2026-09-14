import type { RegionStatus } from "@/lib/extract-stream";
import type { SourceState } from "@/lib/registries/db";

export type Tone = "success" | "warning" | "destructive" | "neutral";

const TONES: Record<string, Tone> = {
  verified: "success", ok: "success", high: "success", valid: "success",
  partial: "warning", pending: "warning", medium: "warning",
  mismatch: "destructive", failed: "destructive", low: "destructive", invalid: "destructive",
};

/** Verdicts, row statuses and confidences share one colour language — the three status tokens. */
export function statusTone(value: string | null | undefined): Tone {
  return (value && TONES[value]) || "neutral";
}

export function toneClass(tone: Tone): string {
  switch (tone) {
    case "success": return "border-success/25 bg-success/10 text-success";
    case "warning": return "border-warning/30 bg-warning/10 text-warning";
    case "destructive": return "border-destructive/25 bg-destructive/10 text-destructive";
    default: return "border-border bg-muted text-muted-foreground";
  }
}

/** The scene's region frames: highlight while the engine is on it, success/destructive
 * once decided, muted for a frame nobody read. The border only — the dimming mask of a
 * reading frame is `regionMaskClass` below. */
export function regionFrameClass(status: RegionStatus): string {
  switch (status) {
    case "found": return "border border-dashed border-highlight/80";
    case "classified": return "border-2 border-highlight";
    case "reading": return "border-2 border-highlight";
    case "read": return "border-2 border-success";
    case "failed": return "border-2 border-destructive";
    case "skipped": return "border border-dashed border-muted-foreground/70";
  }
}
/** The rest of the page, dimmed around the frame being read. It stays on the region box
 * itself rather than on the frame layer: a reading box clips its own beam (overflow-hidden),
 * and a shadow drawn by a child would be clipped away with it. */
export function regionMaskClass(status: RegionStatus): string {
  return status === "reading" ? "shadow-[0_0_0_9999px_color-mix(in_oklch,var(--ink)_38%,transparent)]" : "";
}
/** A registry source's refresh state: running and interrupted need a look, error needs action. */
export function sourceStateTone(state: SourceState): Tone {
  switch (state) {
    case "ok": return "success";
    case "running": case "interrupted": return "warning";
    case "error": return "destructive";
    default: return "neutral";
  }
}

/** An invitation's status: open needs a look, accepted is done, revoked is inert, expired needs action. */
export function invitationTone(status: "pending" | "accepted" | "revoked" | "expired"): Tone {
  switch (status) {
    case "pending": return "warning";
    case "accepted": return "success";
    case "revoked": return "neutral";
    case "expired": return "destructive";
  }
}

export function regionTagClass(status: RegionStatus): string {
  switch (status) {
    // Opaque, every one of them: a tag sits ON the document, and a translucent one takes the
    // tinted print of a card as its background and stops being readable.
    case "found": return "bg-highlight text-highlight-foreground";
    case "classified": case "reading": return "bg-highlight text-highlight-foreground";
    case "read": return "bg-success text-success-foreground";
    case "failed": return "bg-destructive text-destructive-foreground";
    case "skipped": return "bg-muted text-muted-foreground";
  }
}
