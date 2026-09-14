import { CHECK_FIELDS } from "@/lib/registries/check";
import { cn } from "@/lib/utils";
import type { LandingMessages } from "./Landing";

/** The search's query parameters (`parseQuery`), shown as they are sent. */
const SEARCH_PARAMS = ["id", "bank", "branch", "account", "name"];

/** Identifier chips in the "What is read" style: highlight for what the caller sends, neutral for the rest.
 * Each chip is its own LTR island, so the row itself follows the page and starts under its column's text in Hebrew. */
function Chips({ accent, items }: { accent: string; items: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {[accent, ...items].map((f) => <li key={f} dir="ltr" lang="en" className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[11px]", f === accent ? "border-highlight text-highlight" : "border-foreground/20 text-muted-foreground")}>{f}</li>)}
    </ul>
  );
}

export function RegistriesSection({ m }: { m: LandingMessages["registries"] }) {
  return (
    <section id="registries" className="scroll-mt-14 space-y-6">
      <div><h2 className="text-3xl font-semibold tracking-tight">{m.title}</h2><p className="mt-1 max-w-2xl text-muted-foreground">{m.lead}</p></div>
      <ul className="grid gap-4 border-t border-foreground pt-6 sm:grid-cols-3 sm:gap-8">
        {m.sources.map((s) => <li key={s.name} className="border-s-2 border-highlight ps-4"><div className="font-medium">{s.name}</div><div className="text-[13px] text-muted-foreground">{s.note}</div></li>)}
      </ul>
      <div className="grid border-t border-border md:grid-cols-2">
        <div className="min-w-0 space-y-4 py-6 md:border-e md:border-border md:pe-8">
          <h3 className="text-lg font-medium">{m.check.title}</h3>
          <p className="text-[15px] text-muted-foreground">{m.check.text}</p>
          <Chips accent="check_registries=true" items={CHECK_FIELDS} />
        </div>
        <div className="min-w-0 space-y-4 border-t border-border py-6 md:border-t-0 md:ps-8">
          <h3 className="text-lg font-medium">{m.search.title}</h3>
          <p className="text-[15px] text-muted-foreground">{m.search.text}</p>
          <Chips accent="GET /api/v1/registries/search" items={SEARCH_PARAMS} />
        </div>
      </div>
      <p className="border-t border-border pt-4 text-xs text-muted-foreground">{m.note}</p>
    </section>
  );
}
