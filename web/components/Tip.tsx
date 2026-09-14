"use client";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A styled tooltip around any inline content; nothing to say → the child alone. `mono` for codes, models and timestamps;
 * `dir` stays ltr for those, `auto` for prose that may be Hebrew. */
export function Tip({ text, mono = false, dir = "ltr", children }: { text: string | null | undefined; mono?: boolean; dir?: "ltr" | "rtl" | "auto"; children: ReactNode }) {
  if (!text) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span data-tip={text} className="inline-flex">{children}</span></TooltipTrigger>
      <TooltipContent dir={dir} className={cn("whitespace-pre-line", mono && "font-mono")}>{text}</TooltipContent>
    </Tooltip>
  );
}
