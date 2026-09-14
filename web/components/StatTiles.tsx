import { cn } from "@/lib/utils";

export interface StatTile { label: string; value: string; hint?: string; /** A word, not a number: set in sans, its hint on a line of its own. */ text?: boolean }

/** The dashboard's ledger row: an ink rule on top, vertical hairlines between entries, mono numbers. */
/** Tailwind needs the literal class names; the dashboard shows five tiles, the stats modal four. */
const COLUMNS: Record<number, string> = { 4: "md:grid-cols-4", 5: "md:grid-cols-5" };

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <dl className={cn("grid grid-cols-2 border-t border-foreground", COLUMNS[tiles.length] ?? "md:grid-cols-4")}>
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0 border-b border-border py-3 md:border-e md:pe-4 md:me-4 md:last:border-e-0 md:last:me-0 md:last:pe-0">
          <dt className="text-xs text-muted-foreground">{t.label}</dt>
          {t.text ? (
            <>
              {/* leading-8 is text-2xl's line box, so a word sits on the same line as its neighbours' numbers. */}
              <dd className="mt-1 truncate font-sans text-lg leading-8 font-medium tracking-tight">{t.value}</dd>
              {t.hint && <dd className="text-xs text-muted-foreground">{t.hint}</dd>}
            </>
          ) : (
            // Flex, not inline text: as one line "10" and "2026-09" are a single digit run that RTL cannot split.
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-mono text-2xl font-medium tracking-tight tabular-nums">
              <span>{t.value}</span>{t.hint && <span className="font-sans text-xs font-normal text-muted-foreground">{t.hint}</span>}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
