"use client";
import { CopyButton, type CopyLabels } from "@/components/CopyButton";
import { cn } from "@/lib/utils";

export type { CopyLabels };
const EN: CopyLabels = { copy: "Copy", copied: "Copied" };

export function CodeBlock({ code, labels = EN, className }: { code: string; labels?: CopyLabels; className?: string }) {
  return (
    <div dir="ltr" lang="en" className={cn("group relative rounded-md bg-ink text-ink-foreground ring-1 ring-white/10", className)}>
      {/* The block scrolls in both directions and takes its ceiling from the wrapper's own
          max-height (`inherit` copies the computed value), so a caller caps a long listing
          with one class on the outside and the copy button — anchored to the wrapper, not
          the scroller — stays in the corner while the code scrolls under it. */}
      <pre dir="ltr" className="max-h-[inherit] overflow-auto p-4 pe-12 font-mono text-xs leading-relaxed">{code}</pre>
      <CopyButton text={code} labels={labels} className="absolute top-2 end-2 bg-ink/70 text-ink-foreground/60 backdrop-blur-sm hover:bg-white/10 hover:text-white" />
    </div>
  );
}
