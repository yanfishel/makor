import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatFieldDate } from "@/lib/format";
import { bankLabel } from "@/lib/registries/banks";
import type { ResultGroup, SearchResult } from "@/lib/registries/search";

interface Column<R> { head: string; cell: (row: R) => ReactNode }
const date = (v: string | null) => (v ? formatFieldDate(v) ?? v : "—");
const text = (v: string | null | undefined) => v || "—";
/** Names in several scripts, one per line, each in its own direction. */
const names = (...values: (string | null)[]) => values.filter(Boolean).map((v, i) => <span key={i} dir="auto" className="block">{v}</span>);

function GroupTable<R>({ rows, columns }: { rows: R[]; columns: Column<R>[] }) {
  return (
    <div className="overflow-x-auto border-t border-foreground">
      <Table>
        <TableHeader><TableRow>{columns.map((c) => <TableHead key={c.head}>{c.head}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map((row, i) => <TableRow key={i}>{columns.map((c) => <TableCell key={c.head} className="align-top">{c.cell(row)}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  );
}

function GroupRows({ group, locale }: { group: ResultGroup; locale: string }) {
  const t = useTranslations("registries");
  const col = (key: string) => t(`cols.${key}`);
  const mono = (v: string | number) => <span className="font-mono" dir="ltr" lang="en">{v}</span>;
  const designated = (d: string | null, cancelled: boolean, note: string | null) =>
    cancelled ? <span className="flex flex-col gap-1"><StatusBadge value={t("cancelled")} tone="neutral" /><span className="text-xs text-muted-foreground">{note}</span></span> : note ?? date(d);
  switch (group.source) {
    case "boi_accounts":
      return <GroupTable rows={group.rows} columns={[
        { head: col("bank"), cell: (r) => bankLabel(r.bank, locale) },
        { head: col("branch"), cell: (r) => mono(r.branch) },
        { head: col("account"), cell: (r) => mono(r.account) },
        { head: col("start"), cell: (r) => date(r.startDate) },
        { head: col("end"), cell: (r) => date(r.endDate) },
        { head: col("state"), cell: (r) => <StatusBadge value={r.active ? t("active") : t("expired")} tone={r.active ? "destructive" : "neutral"} /> },
      ]} />;
    case "boi_severe":
      return <GroupTable rows={group.rows} columns={[
        { head: col("number"), cell: (r) => mono(r.idNumber) },
        { head: col("name"), cell: (r) => names(r.name) },
        { head: col("end"), cell: (r) => date(r.endDate) },
      ]} />;
    case "companies":
      return <GroupTable rows={group.rows} columns={[
        { head: col("number"), cell: (r) => mono(r.number) },
        { head: col("names"), cell: (r) => names(r.nameHe, r.nameEn) },
        { head: col("type"), cell: (r) => text(r.corpType) },
        { head: col("status"), cell: (r) => (r.status ? <StatusBadge value={r.status} tone={r.status === "פעילה" ? "success" : "neutral"} /> : "—") },
        { head: col("violator"), cell: (r) => (r.violator ? <StatusBadge value={r.violator} tone="warning" /> : "—") },
        { head: col("city"), cell: (r) => text(r.city) },
      ]} />;
    case "nbctf_individuals":
      return <GroupTable rows={group.rows} columns={[
        { head: col("names"), cell: (r) => names(r.nameHe, r.nameEn, r.nameAr) },
        { head: col("ids"), cell: (r) => <span dir="auto" className="whitespace-pre-line">{text(r.idText)}</span> },
        { head: col("nationality"), cell: (r) => text(r.nationality) },
        { head: col("dob"), cell: (r) => date(r.dob) },
        { head: col("designated"), cell: (r) => designated(r.designated, r.cancelled, r.note) },
        { head: col("designation"), cell: (r) => text(r.designation) },
      ]} />;
    case "nbctf_orgs":
      return <GroupTable rows={group.rows} columns={[
        { head: col("names"), cell: (r) => names(r.nameHe, r.nameEn, r.nameAr, r.aliases) },
        { head: col("number"), cell: (r) => (r.corpId ? mono(r.corpId) : "—") },
        { head: col("country"), cell: (r) => text(r.country) },
        { head: col("designated"), cell: (r) => designated(r.designatedPerm ?? r.designatedTemp, r.cancelled, r.note) },
        { head: col("designation"), cell: (r) => text(r.designation) },
      ]} />;
  }
}

/** One section per searched source, in refresh order; then the sources the query could not reach. */
export function RegistryResults({ result, locale }: { result: SearchResult; locale: string }) {
  const t = useTranslations("registries");
  return (
    <div className="space-y-8">
      {result.groups.map((group) => (
        <section key={group.source} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-base font-medium">{t(`sources.${group.source}`)}</h2>
            {group.loaded && <span className="font-mono text-xs text-muted-foreground">{t("count", { n: group.total })}</span>}
            {group.status.dataDate && <span className="text-xs text-muted-foreground">{t("asOf", { date: date(group.status.dataDate) })}</span>}
          </div>
          {!group.loaded && <p className="text-sm text-muted-foreground">{t("notLoaded")}</p>}
          {group.loaded && group.status.status === "error" && <p className="text-xs text-warning">{t("lastFailed")}</p>}
          {group.loaded && group.nameOnly && group.total > 0 && <p className="text-xs text-warning">{t("nameMatch")}</p>}
          {group.loaded && (group.total === 0 ? <p className="text-sm text-muted-foreground">{t("noMatches")}</p> : <GroupRows group={group} locale={locale} />)}
          {group.total > group.rows.length && <p className="text-xs text-muted-foreground">{t("limited", { shown: group.rows.length, total: group.total })}</p>}
        </section>
      ))}
      {result.skipped.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {result.skipped.map((s) => (
            <li key={s.source}>{t("skipped", { source: t(`sources.${s.source}`), fields: s.missing.map((f) => t(`fields.${f}`)).join(", ") })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
