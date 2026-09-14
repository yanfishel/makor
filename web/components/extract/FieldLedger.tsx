"use client";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { DocTypeChip } from "@/components/DocTypeChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { isSefachRegion } from "@/lib/doc-types";
import type { ExtractState, FieldRow, RegionState, WholeState } from "@/lib/extract-stream";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

export interface FieldLedgerProps { state: ExtractState; hoverIndex: number | null; onHover: (i: number | null) => void }

/** The live ledger: one group per frame in reading order — its family chip, then the
 * fields as they came back (the hero's chip, entering with a stagger), ghosts while the
 * frame is being read, the engine's notes underneath. Replaced by ResultView at done. */
export function FieldLedger({ state, hoverIndex, onHover }: FieldLedgerProps) {
  const t = useTranslations("extract.ledger");
  const te = useTranslations("extract");
  const reduced = useReducedMotion();
  const groups: { key: string; i: number | null; status: RegionState["status"] | WholeState["status"]; type?: string; fields?: FieldRow[] }[] = state.toRead.map((i) => {
    if (i === null) return { key: "page", i: null, status: state.whole?.status ?? "reading", type: state.whole?.docType, fields: state.whole?.fields };
    const r = state.regions.find((x) => x.i === i)!;
    return { key: String(i), i, status: r.status, type: r.docType ?? r.kind, fields: r.fields };
  });
  return (
    <div className="space-y-4">
      {groups.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      {groups.map((g) => (
        <section key={g.key} data-region-group={g.key}
          className={cn("space-y-1.5 rounded-md border p-2 transition-colors", hoverIndex !== null && hoverIndex === g.i && "border-highlight bg-highlight/5")}
          onPointerEnter={() => onHover(g.i)} onPointerLeave={() => onHover(null)}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {g.i !== null && <span className="font-mono">{g.i + 1}</span>}
            <DocTypeChip type={g.type ?? null} label={isSefachRegion(g.type) ? te("sefachType") : undefined} />
            {g.status === "reading" && <span className="ms-auto">{t("reading")}</span>}
          </div>
          {g.fields?.map((f, k) => (
            <motion.div key={f.name} className="flex items-center gap-2 rounded-sm border bg-card px-2 py-1 text-xs"
              initial={reduced ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduced ? 0 : k * 0.12, duration: 0.3 }}>
              <span className="font-mono text-muted-foreground">{f.name}</span>
              <span dir="auto" className="ms-auto truncate">{f.value}</span>
              <StatusBadge value={f.confidence} className="h-4 px-1.5 text-[10px]" />
            </motion.div>
          ))}
          {g.status === "reading" && [0, 1, 2].map((k) => <Skeleton key={k} className="h-6 w-full" />)}
        </section>
      ))}
      {state.notes.length > 0 && (
        <div className="space-y-1 text-xs text-warning">
          <p className="font-medium">{t("notes")}</p>
          <ul className="list-disc ps-4">{state.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
