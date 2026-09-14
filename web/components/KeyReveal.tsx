"use client";
import { CopyButton, type CopyLabels } from "@/components/CopyButton";

/** A freshly created API key, shown once: the token beside its copy button, nothing else. */
export function KeyReveal({ value, labels }: { value: string; labels: CopyLabels }) {
  return (
    <div className="flex items-center gap-2 rounded bg-muted ps-2">
      <code dir="ltr" className="min-w-0 flex-1 break-all py-1.5 font-mono text-xs text-foreground">{value}</code>
      <CopyButton text={value} labels={labels} className="shrink-0 text-muted-foreground hover:text-foreground" />
    </div>
  );
}
