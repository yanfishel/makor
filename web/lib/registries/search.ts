import { FIELDS, SOURCE_FIELDS, SOURCE_IDS, listSources, type Field, type RegistriesDb, type SourceId, type SourceStatus } from "@/lib/registries/db";
import { digitsValue, normalizeName } from "@/lib/registries/normalize";

export const RESULT_LIMIT = 50;

export interface RegistryQuery { id: number | null; bank: number | null; branch: number | null; account: number | null; name: string[] }
export interface ParsedQuery { query: RegistryQuery; values: Record<Field, string>; filled: Field[]; valid: boolean; empty: boolean }

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The URL is the query: raw values for the form, normalised values for SQL. */
export function parseQuery(params: Record<string, string | string[] | undefined>): ParsedQuery {
  const values = Object.fromEntries(FIELDS.map((f) => [f, first(params[f]).trim()])) as Record<Field, string>;
  const name = normalizeName(values.name);
  const query: RegistryQuery = {
    id: digitsValue(values.id), bank: digitsValue(values.bank), branch: digitsValue(values.branch), account: digitsValue(values.account),
    name: name ? name.split(" ") : [],
  };
  const filled = FIELDS.filter((f) => (f === "name" ? query.name.length > 0 : query[f] !== null));
  // Bank and branch alone would return thousands of rows; they only narrow an account.
  const valid = query.id !== null || query.account !== null || name.length >= 2;
  return { query, values, filled, valid, empty: filled.length === 0 };
}

export interface Skipped { source: SourceId; missing: Field[] }

export function applicability(filled: readonly Field[]): { searched: SourceId[]; skipped: Skipped[] } {
  const searched: SourceId[] = [];
  const skipped: Skipped[] = [];
  for (const source of SOURCE_IDS) {
    const missing = filled.filter((f) => !SOURCE_FIELDS[source].includes(f));
    if (missing.length) skipped.push({ source, missing });
    else searched.push(source);
  }
  return { searched, skipped };
}

export interface AccountHit { bank: number; branch: number; account: number; startDate: string | null; endDate: string | null; active: boolean }
export interface SevereHit { idNumber: number; name: string | null; endDate: string | null }
export interface CompanyHit { number: number; nameHe: string | null; nameEn: string | null; corpType: string | null; status: string | null; violator: string | null; city: string | null }
export interface IndividualHit { seq: number; nameEn: string | null; nameHe: string | null; nameAr: string | null; nationality: string | null; idText: string | null; dob: string | null; designated: string | null; cancelled: boolean; note: string | null; designation: string | null }
export interface OrgHit { seq: number; nameHe: string | null; nameEn: string | null; nameAr: string | null; aliases: string | null; corpId: string | null; country: string | null; designatedTemp: string | null; designatedPerm: string | null; cancelled: boolean; note: string | null; designation: string | null }
export interface HitMap { boi_accounts: AccountHit; boi_severe: SevereHit; nbctf_individuals: IndividualHit; nbctf_orgs: OrgHit; companies: CompanyHit }
export type ResultGroup = { [S in SourceId]: { source: S; status: SourceStatus; loaded: boolean; total: number; rows: HitMap[S][]; nameOnly: boolean } }[SourceId];
export interface SearchResult { groups: ResultGroup[]; skipped: Skipped[] }

/** Each word a quoted term, ANDed — a prefix term (`"word"*`) for the search page, a whole-word
 * term for the extraction check; quotes are stripped first, so typed FTS syntax stays literal. */
const ftsQuery = (words: string[], exact = false) => words.map((w) => `"${w.replace(/"/g, "")}"${exact ? "" : "*"}`).join(" ");

interface Where { sql: string[]; params: (string | number)[] }
function where(): Where { return { sql: [], params: [] }; }
function add(w: Where, sql: string, param: string | number | null): void {
  if (param === null) return;
  w.sql.push(sql);
  w.params.push(param);
}

function page<T>(db: RegistriesDb, table: string, columns: string, w: Where, order: string, limit: number): { total: number; rows: T[] } {
  const clause = w.sql.length ? `where ${w.sql.join(" and ")}` : "";
  const total = (db.prepare(`select count(*) as n from ${table} ${clause}`).get(...w.params) as { n: number }).n;
  const rows = db.prepare(`select ${columns} from ${table} ${clause} order by ${order} limit ${limit}`).all(...w.params) as T[];
  return { total, rows };
}

export interface QueryOptions { exactName?: boolean; limit?: number }
interface Resolved { exactName: boolean; limit: number }
const nameParam = (q: RegistryQuery, o: Resolved) => (q.name.length ? ftsQuery(q.name, o.exactName) : null);

const QUERIES: { [S in SourceId]: (db: RegistriesDb, q: RegistryQuery, today: string, o: Resolved) => { total: number; rows: HitMap[S][] } } = {
  boi_accounts(db, q, today, o) {
    const w = where();
    add(w, "account = ?", q.account);
    add(w, "bank = ?", q.bank);
    add(w, "branch = ?", q.branch);
    const r = page<Omit<AccountHit, "active">>(db, "boi_accounts", "bank, branch, account, start_date as startDate, end_date as endDate", w, "bank, branch, account", o.limit);
    return { total: r.total, rows: r.rows.map((row) => ({ ...row, active: row.endDate !== null && row.endDate >= today })) };
  },
  boi_severe(db, q, today, o) {
    const w = where();
    add(w, "id_number = ?", q.id);
    add(w, "id in (select rowid from boi_severe_names where boi_severe_names match ?)", nameParam(q, o));
    return page<SevereHit>(db, "boi_severe", "id_number as idNumber, name, end_date as endDate", w, "id_number", o.limit);
  },
  nbctf_individuals(db, q, today, o) {
    const w = where();
    add(w, "id in (select row from nbctf_individuals_ids where digits = ?)", q.id);
    add(w, "id in (select rowid from nbctf_individuals_names where nbctf_individuals_names match ?)", nameParam(q, o));
    const r = page<Omit<IndividualHit, "cancelled"> & { cancelled: number }>(db, "nbctf_individuals",
      "seq, name_en as nameEn, name_he as nameHe, name_ar as nameAr, nationality, id_text as idText, dob, designated, cancelled, note, designation", w, "seq", o.limit);
    return { total: r.total, rows: r.rows.map((row) => ({ ...row, cancelled: row.cancelled === 1 })) };
  },
  nbctf_orgs(db, q, today, o) {
    const w = where();
    add(w, "id in (select row from nbctf_orgs_ids where digits = ?)", q.id);
    add(w, "id in (select rowid from nbctf_orgs_names where nbctf_orgs_names match ?)", nameParam(q, o));
    const r = page<Omit<OrgHit, "cancelled"> & { cancelled: number }>(db, "nbctf_orgs",
      "seq, name_he as nameHe, name_en as nameEn, name_ar as nameAr, aliases, corp_id as corpId, country, designated_temp as designatedTemp, designated_perm as designatedPerm, cancelled, note, designation", w, "seq", o.limit);
    return { total: r.total, rows: r.rows.map((row) => ({ ...row, cancelled: row.cancelled === 1 })) };
  },
  companies(db, q, today, o) {
    const w = where();
    add(w, "number = ?", q.id);
    add(w, "number in (select rowid from companies_names where companies_names match ?)", nameParam(q, o));
    return page<CompanyHit>(db, "companies", "number, name_he as nameHe, name_en as nameEn, corp_type as corpType, status, violator, city", w, "number", o.limit);
  },
};

/** One source, one query — the search page (prefix names, RESULT_LIMIT) and the extraction check
 * (whole-word names, MATCH_LIMIT) both come through here. The caller checks the source is loaded. */
export function querySource<S extends SourceId>(db: RegistriesDb, source: S, query: RegistryQuery, today: string, opts: QueryOptions = {}): { total: number; rows: HitMap[S][] } {
  const run = QUERIES[source] as (db: RegistriesDb, q: RegistryQuery, today: string, o: Resolved) => { total: number; rows: HitMap[S][] };
  return run(db, query, today, { exactName: opts.exactName ?? false, limit: opts.limit ?? RESULT_LIMIT });
}

/** Runs the query against every source that carries all its filled fields. A source never downloaded is reported, not queried.
 * The groups that found something come first, the rest after — each part in source order — so a hit is never below the fold. */
export function searchRegistries(db: RegistriesDb, parsed: ParsedQuery, today: string): SearchResult {
  // Defence in depth: the page already renders a hint and skips this call when the query is
  // invalid, but a caller must never get a query run on its behalf from an incomplete one.
  if (!parsed.valid) return { groups: [], skipped: [] };
  const { searched, skipped } = applicability(parsed.filled);
  const statuses = new Map(listSources(db).map((s) => [s.id, s]));
  const groups = searched.map((source) => {
    const status = statuses.get(source)!;
    const loaded = status.fetchedAt !== null;
    const nameOnly = source.startsWith("nbctf_") && parsed.query.name.length > 0 && parsed.query.id === null;
    const found = loaded ? querySource(db, source, parsed.query, today) : { total: 0, rows: [] };
    return { source, status, loaded, nameOnly, ...found } as ResultGroup;
  });
  return { groups: [...groups.filter((g) => g.total > 0), ...groups.filter((g) => g.total === 0)], skipped };
}
