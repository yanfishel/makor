import { DocSilhouette } from "@/components/DocSilhouette";
import { cn } from "@/lib/utils";
import { READ_TYPES } from "./read-types";
import type { LandingMessages } from "./Landing";

export function WhatIsRead({ m }: { m: LandingMessages["reads"] }) {
  return (
    <section id="reads" className="scroll-mt-14 space-y-6">
      <div><h2 className="text-3xl font-semibold tracking-tight">{m.title}</h2><p className="mt-1 text-muted-foreground">{m.lead}</p></div>
      <ul className="border-t border-foreground">
        {m.types.map((t, i) => { const r = READ_TYPES[i]; return (
          <li key={t.name} className="grid items-center gap-4 border-b border-border py-5 sm:grid-cols-[7rem_13rem_1fr] sm:gap-6">
            <DocSilhouette type={r.type} className="h-12 text-foreground/70" />
            <div><div className="font-medium">{t.name}</div><div className="text-[13px] text-muted-foreground">{t.note}</div></div>
            <ul className="flex flex-wrap gap-1.5" dir="ltr" lang="en">
              {r.fields.map((f) => <li key={f} className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[11px]", r.key.includes(f) ? "border-highlight text-highlight" : "border-foreground/20 text-muted-foreground")}>{f}</li>)}
            </ul>
          </li>
        ); })}
      </ul>
    </section>
  );
}
