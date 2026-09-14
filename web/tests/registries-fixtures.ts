// Synthetic registry fixtures for the registries tests. Every value here is invented;
// nothing is copied from a real download.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { Http } from "@/lib/registries/fetch";
import type { SourceId } from "@/lib/registries/db";
import type { SourceDef } from "@/lib/registries/sources/types";
import { BOI_API, BOI_LISTING_URL } from "@/lib/registries/sources/boi";
import { NBCTF_INDIVIDUALS_URL, NBCTF_ORGS_URL } from "@/lib/registries/sources/nbctf";
import { COMPANIES_PAGE, COMPANIES_RESOURCE_URL, companiesPageUrl } from "@/lib/registries/sources/companies";

const colName = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A one-sheet workbook: strings inline (or shared), numbers as <v>, null as an empty cell. */
export function buildXlsx(rows: (string | number | null)[][], opts: { shared?: boolean } = {}): Uint8Array {
  const strings: string[] = [];
  const cell = (v: string | number | null, ref: string) =>
    v === null ? `<c r="${ref}"/>`
      : typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>`
        : opts.shared ? `<c r="${ref}" t="s"><v>${strings.push(v) - 1}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, `${colName(j)}${i + 1}`)).join("")}</row>`).join("")
  }</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = { "xl/worksheets/sheet1.xml": strToU8(sheet) };
  if (opts.shared) files["xl/sharedStrings.xml"] = strToU8(`<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`);
  return zipSync(files);
}

export const tmpRegistriesFile = () => path.join(mkdtempSync(path.join(tmpdir(), "makor-reg-")), "registries.sqlite3");

export const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
export const zipResponse = (bytes: Uint8Array) => new Response(bytes as BodyInit, { headers: { "content-type": "application/zip" } });
export const xlsxResponse = (bytes: Uint8Array, lastModified = "Thu, 02 Jul 2026 20:11:47 GMT") =>
  new Response(bytes as BodyInit, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "last-modified": lastModified } });

/** A fake network: every URL a test expects maps to a response; anything else is a test bug. */
export const httpOf = (routes: Record<string, () => Response>): Http => async (url) => {
  const route = routes[url];
  if (!route) throw new Error(`unexpected fetch ${url}`);
  return route();
};

/** Hebrew letters to Windows-1255 (U+05D0..U+05EA → 0xE0..0xFA); everything else must be ASCII. */
export function cp1255(text: string): Uint8Array {
  return Uint8Array.from([...text].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 0x05d0 && c <= 0x05ea) return c - 0x05d0 + 0xe0;
    if (c > 0x7f) throw new Error(`cp1255 fixture: unsupported ${ch}`);
    return c;
  }));
}

// header: 00,<name>,<code>,<YYMMDD>,<seq>,<line count incl. header>,<checksum>
export const ACCOUNTS_TXT = [
  "00,WH253T01.PRN,WH ,260910,09749,000003,12345678",
  "0111148000001234562024010120270101",
  "0110001000000000992025050520260505      ",
].join("\r\n") + "\r\n";

export const SEVERE_TXT = [
  "00,WU253T01.PRN,WU ,260910,09749,000003,",
  "01 212 510000003 01/05/2028 דוגמה סחר בעמ",
  "01 212 200000008 13/11/2026  עמותה   ",
].join("\r\n") + "\r\n";

export const boiRoutes = (): Record<string, () => Response> => ({
  [BOI_LISTING_URL]: () => jsonResponse({ topFilesInfo: [{ fileName: "WHPRSM02" }, { fileName: "WXPRSM02" }], buttomFilesInfo: [{ fileName: "WTHMUR02" }] }),
  [`${BOI_API}/DownloadFiles/WHPRSM02`]: () => zipResponse(zipSync({ "WHPRSM02.TXT": strToU8(ACCOUNTS_TXT) })),
  [`${BOI_API}/DownloadFiles/WTHMUR02`]: () => zipResponse(zipSync({ "PVKHMIN2.PRN": cp1255(SEVERE_TXT) })),
});

const IND_EN = ["Header", "internal seq. id", "Date of Designation In Israel (DD/MM/YYYY)", "Name of Individual - English", "Nationality / Residency ", "Individual ID", "D.O.B (DD/MM/YYYY)", "Name of Individual - Hebrew", "Name of Individual - Arabic", "Designation ", "Designated by - Hebrew", "Designated by - English", "Foreign Designation ", "Date of Foreign Designation Date (DD/MM/YYYY)", "Additional information"];
const individual = (cells: Record<string, string | number>) => IND_EN.map((h) => cells[h] ?? "-");

/** Row 1 Hebrew headers (content irrelevant), row 2 English headers, then data, like the real sheet. */
export const INDIVIDUALS_SHEET: (string | number | null)[][] = [
  IND_EN.map((_, i) => `כותרת ${i}`),
  IND_EN,
  individual({ "internal seq. id": 1, "Date of Designation In Israel (DD/MM/YYYY)": 46275, "Name of Individual - English": "JOHN EXAMPLE", "Name of Individual - Hebrew": "ג'ון דוגמה", "Individual ID": "ת\"ז: 123456782; passport A1234567", "D.O.B (DD/MM/YYYY)": "01/02/1970", "Designation ": "הכרזה לדוגמה" }),
  individual({ "internal seq. id": 2, "Date of Designation In Israel (DD/MM/YYYY)": "בוטל ביום 1.1.2020", "Name of Individual - Arabic": "مثال", "Individual ID": "----" }),
  ["", "", ""],
];

const ORG_EN = ["internal seq. id", "Date of temporary designation (DD/MM/YYYY)", "Date of permenant designation (DD/MM/YYYY)", "Organization Name - Hebrew", "Organization Name - Hebrew - aka", "Organization Name - Hebrew - aka 2", "Organization Name - Arabic", "Organization Name - Arabic aka", "Organization Name - English", "Organization Name - English - aka", "Corporation Type - English", "Corporation ID", "Designation Type", "Designation Justification - English", "linked to (internal seq. id)", "Country - English"];
const org = (cells: Record<string, string | number>) => ORG_EN.map((h) => cells[h] ?? "----");

export const ORGS_SHEET: (string | number | null)[][] = [
  ORG_EN.map((_, i) => `כותרת ${i}`),
  ORG_EN,
  org({ "internal seq. id": 7, "Date of temporary designation (DD/MM/YYYY)": "25/03/2026", "Date of permenant designation (DD/MM/YYYY)": "--/--/----", "Organization Name - Hebrew": "קרן דוגמה", "Organization Name - Hebrew - aka": "הקרן", "Organization Name - English": "EXAMPLE FUND", "Organization Name - English - aka": "EXAMPLE-FUND LTD", "Corporation Type - English": "Company", "Corporation ID": "510000003", "Designation Type": "הכרזה", "Designation Justification - English": "Example", "linked to (internal seq. id)": "3", "Country - English": "United Kingdom" }),
];

export const nbctfRoutes = (): Record<string, () => Response> => ({
  [NBCTF_INDIVIDUALS_URL]: () => xlsxResponse(buildXlsx(INDIVIDUALS_SHEET)),
  [NBCTF_ORGS_URL]: () => xlsxResponse(buildXlsx(ORGS_SHEET, { shared: true })),
});

/** A datastore record as data.gov.il returns it: Hebrew keys, numbers as numbers, blanks as "" or null. */
export const companyRecord = (number: number | null, nameHe: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  _id: number, "מספר חברה": number, "שם חברה": nameHe, "שם באנגלית": "", "סוג תאגיד": "ישראלית חברה פרטית", "סטטוס חברה": "פעילה",
  "תאור חברה": "", "מפרה": "", "תאריך התאגדות": "13/09/1996", "שם עיר": "תל אביב - יפו", "שם רחוב": "", "מספר בית": "", "מיקוד": null, ...extra,
});

export const COMPANY_RECORDS = [
  companyRecord(510000003, "דוגמה בע~מ", { "שם באנגלית": "EXAMPLE LTD", "מפרה": "מפרה", "שם רחוב": "הדוגמה", "מספר בית": "5", "מיקוד": 6100000 }),
  companyRecord(510000011, "מסחר ישיר בע~מ", { "סטטוס חברה": "מחוקה" }),
  companyRecord(510000029, "שירותי ענן בע~מ"),
];

/** Paged datastore responses over `records`; `total` defaults to the true count. */
export function companiesRoutes(records = COMPANY_RECORDS, pageSize = COMPANIES_PAGE, total = records.length): Record<string, () => Response> {
  const routes: Record<string, () => Response> = {
    [COMPANIES_RESOURCE_URL]: () => jsonResponse({ success: true, result: { last_modified: "2026-09-12T01:14:40.573725" } }),
  };
  for (let offset = 0; offset <= records.length; offset += pageSize) {
    routes[companiesPageUrl(pageSize, offset)] = () => jsonResponse({ success: true, result: { total, records: records.slice(offset, offset + pageSize) } });
  }
  return routes;
}

/** Every real source's URL answered from the synthetic fixtures. */
export const fixtureHttp = (): Http => httpOf({ ...boiRoutes(), ...nbctfRoutes(), ...companiesRoutes() });

/** A fake source with one table named after its id holding `value`; `gate` holds the load open. */
export const tableSource = (id: SourceId, value: string, gate?: Promise<void>): SourceDef => ({
  id, tables: [id],
  async load(db) {
    await gate;
    db.exec(`create table ${id}_new (v text)`);
    db.prepare(`insert into ${id}_new values (?)`).run(value);
    return { rowCount: 1, dataDate: "2026-09-10" };
  },
});

export const failingSource = (id: SourceId, message: string): SourceDef => ({
  id, tables: [id],
  async load(db) {
    db.exec(`create table ${id}_new (v text)`);
    throw new Error(message);
  },
});
