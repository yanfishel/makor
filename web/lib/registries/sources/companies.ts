import { FTS_OPTIONS, type RegistriesDb } from "@/lib/registries/db";
import { fetchJson, type Http } from "@/lib/registries/fetch";
import { digitsValue, isoFromDmy, normalizeName } from "@/lib/registries/normalize";
import type { LoadResult, SourceDef } from "@/lib/registries/sources/types";

export const DATA_GOV_API = "https://data.gov.il/api/3/action";
export const COMPANIES_RESOURCE = "f004176c-b85f-4542-8901-7b3176f9a054";
/** ~730 k rows in 15 pages; a page is ~45 MB of JSON, parsed and inserted before the next is fetched. */
export const COMPANIES_PAGE = 50_000;
export const COMPANIES_RESOURCE_URL = `${DATA_GOV_API}/resource_show?id=${COMPANIES_RESOURCE}`;
/** Sorted by _id so offsets stay stable across pages; the CSV download itself sits behind a Google login. */
export const companiesPageUrl = (pageSize: number, offset: number) =>
  `${DATA_GOV_API}/datastore_search?resource_id=${COMPANIES_RESOURCE}&limit=${pageSize}&offset=${offset}&sort=_id%20asc`;

export interface CompanyRow {
  number: number; nameHe: string | null; nameEn: string | null; corpType: string | null; status: string | null;
  description: string | null; violator: string | null; incorporated: string | null; city: string | null;
  street: string | null; house: string | null; zip: string | null;
}

/** Text as displayed: trimmed, empty → null, and the `~` the registry writes for a quote turned back into `"`. */
const text = (v: unknown): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s.replace(/~/g, '"') : null;
};

export function mapCompany(r: Record<string, unknown>): CompanyRow | null {
  const number = digitsValue(text(r["מספר חברה"]));
  if (number === null) return null;
  const incorporated = text(r["תאריך התאגדות"]);
  return {
    number, nameHe: text(r["שם חברה"]), nameEn: text(r["שם באנגלית"]), corpType: text(r["סוג תאגיד"]), status: text(r["סטטוס חברה"]),
    description: text(r["תאור חברה"]), violator: text(r["מפרה"]), incorporated: incorporated ? isoFromDmy(incorporated) : null,
    city: text(r["שם עיר"]), street: text(r["שם רחוב"]), house: text(r["מספר בית"]), zip: text(r["מיקוד"]),
  };
}

interface Page { success: boolean; result: { total: number; records: Record<string, unknown>[] } }

export async function loadCompanies(db: RegistriesDb, http: Http, pageSize = COMPANIES_PAGE): Promise<LoadResult> {
  const resource = await fetchJson<{ result?: { last_modified?: string | null } }>(http, COMPANIES_RESOURCE_URL);
  db.exec(`create table companies_new (number integer primary key, name_he text, name_en text, corp_type text, status text, description text, violator text, incorporated text, city text, street text, house text, zip text);
    create virtual table companies_names_new using fts5(name_he, name_en, ${FTS_OPTIONS})`);
  // `or ignore`: a repeated number must not abort a 730 k-row load; the table keeps the first.
  const insert = db.prepare("insert or ignore into companies_new values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const name = db.prepare("insert into companies_names_new (rowid, name_he, name_en) values (?, ?, ?)");
  let read = 0;
  let total: number | null = null;
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchJson<Page>(http, companiesPageUrl(pageSize, offset));
    if (!page.success) throw new Error("companies: the datastore answered success=false");
    total ??= page.result.total;
    db.transaction(() => {
      for (const record of page.result.records) {
        const c = mapCompany(record);
        if (!c) continue;
        if (insert.run(c.number, c.nameHe, c.nameEn, c.corpType, c.status, c.description, c.violator, c.incorporated, c.city, c.street, c.house, c.zip).changes) {
          name.run(c.number, normalizeName(c.nameHe), normalizeName(c.nameEn));
        }
      }
    })();
    read += page.result.records.length;
    if (page.result.records.length < pageSize) break;
  }
  if (read !== total) throw new Error(`companies: read ${read} of ${total} rows`);
  const rowCount = (db.prepare("select count(*) as n from companies_new").get() as { n: number }).n;
  return { rowCount, dataDate: resource.result?.last_modified?.slice(0, 10) ?? null };
}

export const companies: SourceDef = {
  id: "companies",
  tables: ["companies", "companies_names"],
  load: (db, http) => loadCompanies(db, http),
};
