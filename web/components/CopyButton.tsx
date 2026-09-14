"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface CopyLabels { copy: string; copied: string }

/** Copies `text` to the clipboard; the icon turns into a check for a moment. */
export function CopyButton({ text, labels, className }: { text: string; labels: CopyLabels; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable: nothing to show */ }
  }
  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={copy} aria-label={done ? labels.copied : labels.copy} className={className}>
      {done ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}
