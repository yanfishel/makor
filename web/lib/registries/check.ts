import { listSources, SOURCE_IDS, type RegistriesDb, type SourceId } from "@/lib/registries/db";
import { digitsValue, normalizeName } from "@/lib/registries/normalize";
import { querySource, type HitMap, type RegistryQuery } from "@/lib/registries/search";

/** Rows per lookup: more than this for one exact number or full name already means "open the registry". */
export const MATCH_LIMIT = 10;
export const REGISTRIES_UNAVAILABLE = "REGISTRIES_UNAVAILABLE";

export type MatchLevel = "alert" | "info";
export type MatchBy = "id" | "account" | "name";
export const CHECK_FIELDS = ["id_number", "spouse_id_number", "child_id_number", "drawer_id_number", "guarantor_id_number", "account", "name_he", "name_en"] as const;
export type CheckField = (typeof CHECK_FIELDS)[number];
export type RegistryMatch = { [S in SourceId]: { level: MatchLevel; source: S; by: MatchBy; field: CheckField; record: HitMap[S] } }[SourceId];
/** `checked` = the lookup keys that ran against at least one loaded source (field names only), so a
 * check that looked nothing up never reads as a clean one. */
export interface RegistriesCheck { sources: { id: SourceId; data_date: string | null; loaded: boolean }[]; checked: CheckField[]; matches: RegistryMatch[] }
export type RegistriesResult = RegistriesCheck | { error: typeof REGISTRIES_UNAVAILABLE };
export interface SummaryItem { source: SourceId; by: MatchBy; count: number }
/** `checked` is absent on a row written before it existed: unknown, rendered as a check that ran. */
export type RegistriesSummary = { alerts: SummaryItem[]; infos: SummaryItem[]; checked?: CheckField[] } | { error: typeof REGISTRIES_UNAVAILABLE };

const ID_SOURCES: readonly SourceId[] = ["boi_severe", "nbctf_individuals", "nbctf_orgs", "companies"];
const EMPTY: RegistryQuery = { id: null, bank: null, branch: null, account: null, name: [] };

interface Payload {
  fields?: Record<string, unknown>;
  sefach?: { spouse?: { id_number?: string | null } | null; children?: { id_number?: string | null }[] } | null;
}
interface Lookup { field: CheckField; by: MatchBy; sources: readonly SourceId[]; query: RegistryQuery }

/** `fields.<name>.value` as text, or null — the engine's `{value, confidence}` shape, tolerant of anything else. */
function fieldValue(p: Payload, name: string): string | null {
  const field = p.fields?.[name];
  const value = field && typeof field === "object" && "value" in field ? (field as { value: unknown }).value : null;
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value : null;
}

/** What a document offers to look up, in the spec's order; a number seen under an earlier key is not looked up again. */
function lookups(p: Payload): Lookup[] {
  const out: Lookup[] = [];
  const seen = new Set<number>();
  const byId = (field: CheckField, raw: string | null | undefined) => {
    const id = digitsValue(raw ?? null);
    if (id === null || seen.has(id)) return;
    seen.add(id);
    out.push({ field, by: "id", sources: ID_SOURCES, query: { ...EMPTY, id } });
  };
  byId("id_number", fieldValue(p, "id_number"));
  byId("spouse_id_number", p.sefach?.spouse?.id_number);
  for (const child of p.sefach?.children ?? []) byId("child_id_number", child?.id_number);
  byId("drawer_id_number", fieldValue(p, "drawer_id_number"));
  byId("guarantor_id_number", fieldValue(p, "guarantor_id_number"));

  const bank = digitsValue(fieldValue(p, "bank_code"));
  const branch = digitsValue(fieldValue(p, "branch_number"));
  const account = digitsValue(fieldValue(p, "account_number"));
  if (bank !== null && branch !== null && account !== null) out.push({ field: "account", by: "account", sources: ["boi_accounts"], query: { ...EMPTY, bank, branch, account } });

  for (const [field, first, last] of [["name_he", "first_name_he", "last_name_he"], ["name_en", "first_name_en", "last_name_en"]] as const) {
    const firstName = fieldValue(p, first);
    const lastName = fieldValue(p, last);
    if (!firstName || !lastName) continue;
    const words = normalizeName(`${firstName} ${lastName}`).split(" ").filter(Boolean);
    if (words.length < 2 || words.some((w) => w.length < 2)) continue;
    out.push({ field, by: "name", sources: ["nbctf_individuals"], query: { ...EMPTY, name: words } });
  }
  return out;
}

type UnleveledMatch = { [S in SourceId]: { source: S; record: HitMap[S] } }[SourceId];

/** Alert = something to act on; info = context (an active company — a violator (מפרה) too, which mostly
 * means an unpaid annual fee or a late report — or a lapsed restriction). */
function levelOf(match: UnleveledMatch, today: string): MatchLevel {
  switch (match.source) {
    case "boi_accounts": return match.record.active ? "alert" : "info";
    case "boi_severe": return match.record.endDate === null || match.record.endDate >= today ? "alert" : "info";
    case "nbctf_individuals":
    case "nbctf_orgs": return match.record.cancelled ? "info" : "alert";
    case "companies": return match.record.status !== "פעילה" ? "alert" : "info";
  }
}

/** Every lookup the payload offers, against every loaded source that carries its field. Pure over the database; never logs. */
export function checkRegistries(db: RegistriesDb, payload: unknown, today: string): RegistriesCheck {
  const p = (payload && typeof payload === "object" ? payload : {}) as Payload;
  const statuses = listSources(db);
  const loaded = new Set(statuses.filter((s) => s.fetchedAt !== null).map((s) => s.id));
  const matches: RegistryMatch[] = [];
  const checked = new Set<CheckField>();
  for (const lookup of lookups(p)) {
    for (const source of SOURCE_IDS) {
      if (!lookup.sources.includes(source) || !loaded.has(source)) continue;
      checked.add(lookup.field);
      for (const record of querySource(db, source, lookup.query, today, { exactName: true, limit: MATCH_LIMIT }).rows) {
        const found = { source, record } as UnleveledMatch;
        matches.push({ ...found, by: lookup.by, field: lookup.field, level: levelOf(found, today) } as RegistryMatch);
      }
    }
  }
  return {
    sources: statuses.map((s) => ({ id: s.id, data_date: s.dataDate, loaded: s.fetchedAt !== null })),
    checked: CHECK_FIELDS.filter((f) => checked.has(f)),
    matches: [...matches.filter((m) => m.level === "alert"), ...matches.filter((m) => m.level === "info")],
  };
}

/** The row's copy: per (source, kind) counts and the checked field names only — no numbers, names or records. */
export function summarizeCheck(result: RegistriesResult): RegistriesSummary {
  if ("error" in result) return { error: result.error };
  const group = (level: MatchLevel): SummaryItem[] => {
    const items: SummaryItem[] = [];
    for (const m of result.matches) {
      if (m.level !== level) continue;
      const item = items.find((i) => i.source === m.source && i.by === m.by);
      if (item) item.count += 1;
      else items.push({ source: m.source, by: m.by, count: 1 });
    }
    return items;
  };
  return { alerts: group("alert"), infos: group("info"), checked: [...result.checked] };
}

export function parseSummary(text: string | null): RegistriesSummary | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Record<string, unknown> | null;
    if (v && v.error === REGISTRIES_UNAVAILABLE) return { error: REGISTRIES_UNAVAILABLE };
    if (v && Array.isArray(v.alerts) && Array.isArray(v.infos) && (v.checked === undefined || Array.isArray(v.checked))) return v as unknown as RegistriesSummary;
  } catch {
    // a malformed value reads as no check
  }
  return null;
}
