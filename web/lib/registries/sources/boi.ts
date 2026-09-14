import { FTS_OPTIONS, indexName } from "@/lib/registries/db";
import { fetchBytes, fetchJson, type Http } from "@/lib/registries/fetch";
import { isoFromDmy, isoFromYymmdd, isoFromYyyymmdd, normalizeName } from "@/lib/registries/normalize";
import type { SourceDef } from "@/lib/registries/sources/types";
import { unzipFirst } from "@/lib/registries/xlsx";

/** The mugbalim SPA's own API: the HTML site is behind a WAF challenge, this is not. */
export const BOI_API = "https://mugbalim.boi.org.il/api/public/umbraco/api";
export const BOI_LISTING_URL = `${BOI_API}/DownloadFilesPage/he/PublicDownload`;
const ACCOUNTS_FILE = "WHPRSM02";
const SEVERE_FILE = "WTHMUR02";

export interface BoiHeader { dataDate: string | null; lineCount: number }
export interface AccountRow { bank: number; branch: number; account: number; startDate: string | null; endDate: string | null }
export interface SevereRow { idNumber: number; name: string; endDate: string | null }

/** Windows-1255 is ASCII-compatible, so the ASCII accounts file decodes the same way. */
export const decodeBoiText = (bytes: Uint8Array) => new TextDecoder("windows-1255").decode(bytes);

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

/** `00,<name>,<code>,<YYMMDD>,<seq>,<line count incl. header>,<checksum>`; the count is checked. */
function withHeader(text: string, what: string): { header: BoiHeader; lines: string[] } {
  const all = splitLines(text);
  const m = /^00,[^,]*,[^,]*,(\d{6}),[^,]*,(\d+)/.exec(all[0] ?? "");
  if (!m) throw new Error(`${what}: unrecognised header line`);
  const header = { dataDate: isoFromYymmdd(m[1]), lineCount: Number(m[2]) };
  if (header.lineCount !== all.length) throw new Error(`${what}: header line count ${header.lineCount}, file has ${all.length}`);
  return { header, lines: all.slice(1) };
}

/** Fixed width: record 01 (2) · bank (2) · branch (3) · account (11) · start YYYYMMDD · end YYYYMMDD. */
export function parseAccounts(text: string): { header: BoiHeader; rows: AccountRow[] } {
  const { header, lines } = withHeader(text, "restricted accounts");
  const rows = lines.map((line, i) => {
    const m = /^01(\d{2})(\d{3})(\d{11})(\d{8})(\d{8})\s*$/.exec(line);
    if (!m) throw new Error(`restricted accounts: malformed line ${i + 2}`);
    return { bank: Number(m[1]), branch: Number(m[2]), account: Number(m[3]), startDate: isoFromYyyymmdd(m[4]), endDate: isoFromYyyymmdd(m[5]) };
  });
  return { header, rows };
}

/** `01 212 <9-digit id> <DD/MM/YYYY> <name to the end of the line>`. */
export function parseSevere(text: string): { header: BoiHeader; rows: SevereRow[] } {
  const { header, lines } = withHeader(text, "severely restricted corporations");
  const rows = lines.map((line, i) => {
    const m = /^01 \d{3} (\d{9}) (\d{2}\/\d{2}\/\d{4}) ?(.*)$/.exec(line);
    if (!m) throw new Error(`severely restricted corporations: malformed line ${i + 2}`);
    return { idNumber: Number(m[1]), name: m[3].trim(), endDate: isoFromDmy(m[2]) };
  });
  return { header, rows };
}

interface Listing { topFilesInfo?: { fileName: string }[]; buttomFilesInfo?: { fileName: string }[] }

/** Files are located by name in the listing: a renamed or withdrawn file is an error, not an empty load. */
async function boiFile(http: Http, name: string): Promise<Uint8Array> {
  const listing = await fetchJson<Listing>(http, BOI_LISTING_URL);
  const names = [...(listing.topFilesInfo ?? []), ...(listing.buttomFilesInfo ?? [])].map((f) => f.fileName);
  if (!names.includes(name)) throw new Error(`Bank of Israel: ${name} is not listed`);
  return unzipFirst((await fetchBytes(http, `${BOI_API}/DownloadFiles/${name}`)).bytes).data;
}

export const boiAccounts: SourceDef = {
  id: "boi_accounts",
  tables: ["boi_accounts"],
  async load(db, http) {
    const { header, rows } = parseAccounts(decodeBoiText(await boiFile(http, ACCOUNTS_FILE)));
    db.exec("create table boi_accounts_new (bank integer not null, branch integer not null, account integer not null, start_date text, end_date text)");
    const insert = db.prepare("insert into boi_accounts_new values (?, ?, ?, ?, ?)");
    db.transaction(() => { for (const r of rows) insert.run(r.bank, r.branch, r.account, r.startDate, r.endDate); })();
    db.exec(`create index ${indexName("boi_accounts")} on boi_accounts_new (bank, branch, account); create index ${indexName("boi_accounts")} on boi_accounts_new (account)`);
    return { rowCount: rows.length, dataDate: header.dataDate };
  },
};

export const boiSevere: SourceDef = {
  id: "boi_severe",
  tables: ["boi_severe", "boi_severe_names"],
  async load(db, http) {
    const { header, rows } = parseSevere(decodeBoiText(await boiFile(http, SEVERE_FILE)));
    db.exec(`create table boi_severe_new (id integer primary key, id_number integer not null, name text, end_date text);
      create virtual table boi_severe_names_new using fts5(name, ${FTS_OPTIONS})`);
    const insert = db.prepare("insert into boi_severe_new values (?, ?, ?, ?)");
    const name = db.prepare("insert into boi_severe_names_new (rowid, name) values (?, ?)");
    db.transaction(() => {
      rows.forEach((r, i) => { insert.run(i + 1, r.idNumber, r.name, r.endDate); name.run(i + 1, normalizeName(r.name)); });
    })();
    db.exec(`create index ${indexName("boi_severe")} on boi_severe_new (id_number)`);
    return { rowCount: rows.length, dataDate: header.dataDate };
  },
};
