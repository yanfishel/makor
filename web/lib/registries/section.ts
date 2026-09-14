import type { CheckField, MatchBy, MatchLevel, RegistriesResult, RegistriesSummary, RegistryMatch, SummaryItem } from "@/lib/registries/check";
import type { SourceId } from "@/lib/registries/db";
import { bankLabel } from "@/lib/registries/banks";
import { formatFieldDate } from "@/lib/format";

/** A next-intl translator bound to one namespace, as the helpers here need it (tests use createTranslator). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The documents table's tooltip: one line per alert kind, then the info kinds, then where the
 * details are — counts only, as the row stores them. `tc` = registries.check, `ts` = registries.sources. */
export function summaryTip(summary: RegistriesSummary, tc: Translate, ts: Translate, hasResult: boolean): string | null {
  if ("error" in summary) return null;
  const line = (key: "tipItem" | "tipInfo") => (i: SummaryItem) => tc(key, { source: ts(i.source), by: tc(`by.${i.by}`), count: i.count });
  const lines = [...summary.alerts.map(line("tipItem")), ...summary.infos.map(line("tipInfo"))];
  if (lines.length && hasResult) lines.push(tc("tipDetails"));
  return lines.length ? lines.join("\n") : null;
}

export type RegistriesRow =
  | { kind: "match"; field: CheckField; source: SourceId; level: MatchLevel; by: MatchBy; summary: string }
  | { kind: "note"; text: string };

const day = (v: string | null) => (v ? formatFieldDate(v) ?? v : null);
const join = (parts: (string | number | null | undefined)[]) => parts.filter((part) => part !== null && part !== undefined && part !== "").join(" · ");
const names = (...values: (string | null)[]) => values.filter(Boolean).join(" / ");

/** The one line a match shows: the record's identifying data, as the registry prints it. `tc` = registries.check. */
export function recordSummary(match: RegistryMatch, tc: Translate, locale: string): string {
  switch (match.source) {
    case "companies": {
      const r = match.record;
      return join([r.number, r.nameHe ?? r.nameEn, r.status, r.violator]);
    }
    case "boi_severe": {
      const r = match.record;
      return join([r.idNumber, r.name, r.endDate ? tc("until", { date: day(r.endDate)! }) : null]);
    }
    case "boi_accounts": {
      const r = match.record;
      return join([bankLabel(r.bank, locale), r.branch, r.account, [day(r.startDate), day(r.endDate)].filter(Boolean).join("–")]);
    }
    case "nbctf_individuals": {
      const r = match.record;
      return join([names(r.nameHe, r.nameEn, r.nameAr), r.cancelled ? r.note : r.designated ? tc("designated", { date: day(r.designated)! }) : null, r.designation]);
    }
    case "nbctf_orgs": {
      const r = match.record;
      const designated = r.designatedPerm ?? r.designatedTemp;
      return join([names(r.nameHe, r.nameEn, r.nameAr), r.corpId, r.cancelled ? r.note : designated ? tc("designated", { date: day(designated)! }) : null, r.designation]);
    }
  }
}

/** The result view's section rows: a note when there is nothing to list, else one row per match. A
 * check that looked nothing up says so — it must never read as a clean one; a clean one is a plain
 * "not found", no dates or sources. `tc` = registries.check. */
export function registriesRows(result: RegistriesResult, tc: Translate, locale: string): RegistriesRow[] {
  if ("error" in result) return [{ kind: "note", text: tc("failed") }];
  const loaded = result.sources.filter((s) => s.loaded);
  if (loaded.length === 0) return [{ kind: "note", text: tc("notLoaded") }];
  // A result stored before `checked` existed has none: unknown, rendered as a check that ran.
  if ((result.checked as CheckField[] | undefined)?.length === 0) return [{ kind: "note", text: tc("nothingChecked") }];
  if (result.matches.length === 0) return [{ kind: "note", text: tc("notFound") }];
  return result.matches.map((m): RegistriesRow => ({ kind: "match", field: m.field, source: m.source, level: m.level, by: m.by, summary: recordSummary(m, tc, locale) }));
}
