"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DocTypeChip } from "@/components/DocTypeChip";
import { LocalTime } from "@/components/LocalTime";
import { StatusBadge } from "@/components/StatusBadge";
import { Tip } from "@/components/Tip";
import type { DocumentMeta } from "@/lib/documents";
import { engineChipClass, sourceChipClass } from "@/lib/chip-tone";
import { formatCost, formatMs, formatTokens, statusLabel } from "@/lib/format";
import { summaryTip, type Translate } from "@/lib/registries/section";
import { cn } from "@/lib/utils";

/** A translated label for an enumerated value, the raw value when the vocabulary has grown past the messages. */
function useLabel(ns: "verdicts" | "statuses" | "engines" | "sources") {
  const t = useTranslations(`labels.${ns}`);
  return (value: string) => (t.has(value) ? t(value) : value);
}

/** One row per document; a row with a stored result opens it (the whole row is the target, no link). */
export function DocumentsTable({ rows, locale }: { rows: DocumentMeta[]; locale: string }) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("registries.check") as unknown as Translate;
  const ts = useTranslations("registries.sources") as unknown as Translate;
  const verdict = useLabel("verdicts");
  const status = useLabel("statuses");
  const engine = useLabel("engines");
  const source = useLabel("sources");
  const router = useRouter();
  const registriesCell = (r: DocumentMeta) => {
    if (!r.registries) return null;
    if ("error" in r.registries) return <StatusBadge value={tc("pillFailed")} tone="warning" className="font-sans" />;
    // Nothing was looked up (no number, account or full name): no dash, which would read as a clean check.
    if (r.registries.checked && r.registries.checked.length === 0) return null;
    const tip = summaryTip(r.registries, tc, ts, r.hasResult);
    if (r.registries.alerts.length) return <Tip text={tip} dir="auto"><StatusBadge value={tc("pill")} tone="destructive" className="font-sans" /></Tip>;
    // Info only (an active company, a lapsed restriction): found, so a pill — but a neutral one.
    if (r.registries.infos.length) return <Tip text={tip} dir="auto"><StatusBadge value={tc("levels.info")} tone="neutral" className="font-sans" /></Tip>;
    return <span className="text-muted-foreground">—</span>;
  };
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <div className="overflow-x-auto border-t border-foreground">
      <Table>
        <TableHeader><TableRow>{[t("colDate"), t("colType"), t("colVerdict"), t("colRegistries"), t("colStatus"), t("colBackend"), t("colSource"), t("colLatency"), t("colTokens"), t("colCost")].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => {
            const s = statusLabel(r);
            const href = r.hasResult ? `/app/documents/${r.id}` : null;
            const open = () => { if (href) router.push(href); };
            return (
              <TableRow key={r.id} data-href={href ?? undefined} className={cn(href && "cursor-pointer")} tabIndex={href ? 0 : undefined}
                onClick={open} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }}>
                <TableCell className="whitespace-nowrap"><LocalTime iso={r.createdAt} locale={locale} className={cn(href && "text-highlight")} /></TableCell>
                <TableCell><DocTypeChip type={r.docType} /></TableCell>
                <TableCell>{r.verdict ? <StatusBadge value={verdict(r.verdict)} tone={r.verdict} className="font-sans" /> : "—"}</TableCell>
                <TableCell>{registriesCell(r)}</TableCell>
                <TableCell><Tip text={s === "failed" ? r.errorCode ?? String(r.status) : null} mono><StatusBadge value={status(s)} tone={s} className="font-sans" /></Tip></TableCell>
                <TableCell>{r.backend ? <Tip text={r.model} mono><StatusBadge value={engine(r.backend)} tone="neutral" className={cn("font-sans", engineChipClass(r.backend))} /></Tip> : "—"}</TableCell>
                <TableCell><StatusBadge value={source(r.source)} tone="neutral" className={cn("font-sans", sourceChipClass(r.source))} /></TableCell>
                <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{formatMs(r.latencyMs)}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground" dir="ltr">{formatTokens(r.tokensIn, r.tokensOut, locale)}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground" dir="ltr">{formatCost(r.costUsd)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
