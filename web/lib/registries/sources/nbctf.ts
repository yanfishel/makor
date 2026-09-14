import { FTS_OPTIONS, indexName, type RegistriesDb } from "@/lib/registries/db";
import { fetchBytes, type Http } from "@/lib/registries/fetch";
import { digitsValue, isoFromCell, normalizeName } from "@/lib/registries/normalize";
import type { LoadResult, SourceDef } from "@/lib/registries/sources/types";
import { readFirstSheet } from "@/lib/registries/xlsx";

const DOCS = "https://nbctf.mod.gov.il/he/Announcements/Documents";
export const NBCTF_INDIVIDUALS_URL = `${DOCS}/NBCTF%20Israel%20designation%20Individuals_XL.xlsx`;
export const NBCTF_ORGS_URL = `${DOCS}/NBCTFIsrael%20-%20Terror%20Organization%20Designation%20List_XL.xlsx`;

const PLACEHOLDERS = new Set(["", "-", "--", "---", "----", "--/--/----"]);
const cell = (v: string | undefined): string | null => {
  const s = (v ?? "").trim();
  return PLACEHOLDERS.has(s) ? null : s;
};
const normHeader = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The ID cell is free text mixing Israeli, Palestinian and foreign documents; every digit run of five or more is searchable. */
export function idDigits(text: string | null): number[] {
  const out: number[] = [];
  for (const m of (text ?? "").matchAll(/\d{5,}/g)) {
    const n = digitsValue(m[0]);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

/** A designation date cell holds a date, or a note such as "בוטל ביום …" when the designation was cancelled. */
function designationCell(v: string | null): { date: string | null; note: string | null; cancelled: boolean } {
  if (!v) return { date: null, note: null, cancelled: false };
  const date = isoFromCell(v);
  return date ? { date, note: null, cancelled: false } : { date: null, note: v, cancelled: /בוטל/.test(v) };
}

/** Columns are found by the English header row, never by letter, so an inserted column cannot shift a field. */
function columns(rows: string[][]) {
  const at = rows.findIndex((r) => r.some((c) => normHeader(c) === "internal seq. id"));
  if (at < 0) throw new Error("NBCTF: header row not found");
  const headers = rows[at].map(normHeader);
  const one = (re: RegExp, label: string) => {
    const i = headers.findIndex((h) => re.test(h));
    if (i < 0) throw new Error(`NBCTF: column "${label}" not found`);
    return i;
  };
  const all = (re: RegExp) => headers.flatMap((h, i) => (re.test(h) ? [i] : []));
  const data = rows.slice(at + 1).filter((r) => digitsValue(cell(r[one(/^internal seq\. id$/, "internal seq. id")])) !== null);
  return { one, all, data };
}

export interface IndividualRow {
  seq: number; designated: string | null; cancelled: boolean; note: string | null;
  nameEn: string | null; nameHe: string | null; nameAr: string | null; nationality: string | null;
  idText: string | null; dob: string | null; designation: string | null; designatedBy: string | null;
  foreignDesignation: string | null; info: string | null; ids: number[];
}

export function parseIndividuals(rows: string[][]): IndividualRow[] {
  const { one, data } = columns(rows);
  const c = {
    seq: one(/^internal seq\. id$/, "internal seq. id"), designated: one(/^date of designation in israel/, "Date of Designation In Israel"),
    nameEn: one(/^name of individual - english$/, "Name of Individual - English"), nameHe: one(/^name of individual - hebrew$/, "Name of Individual - Hebrew"),
    nameAr: one(/^name of individual - arabic$/, "Name of Individual - Arabic"), nationality: one(/^nationality/, "Nationality / Residency"),
    id: one(/^individual id$/, "Individual ID"), dob: one(/^d\.o\.b/, "D.O.B"), designation: one(/^designation$/, "Designation"),
    designatedBy: one(/^designated by - english$/, "Designated by - English"), foreign: one(/^foreign designation$/, "Foreign Designation"),
    info: one(/^additional information$/, "Additional information"),
  };
  return data.map((r) => {
    const designated = designationCell(cell(r[c.designated]));
    const idText = cell(r[c.id]);
    const dob = cell(r[c.dob]);
    return {
      seq: digitsValue(cell(r[c.seq]))!, designated: designated.date, cancelled: designated.cancelled, note: designated.note,
      nameEn: cell(r[c.nameEn]), nameHe: cell(r[c.nameHe]), nameAr: cell(r[c.nameAr]), nationality: cell(r[c.nationality]),
      idText, dob: dob ? isoFromCell(dob) ?? dob : null, designation: cell(r[c.designation]), designatedBy: cell(r[c.designatedBy]),
      foreignDesignation: cell(r[c.foreign]), info: cell(r[c.info]), ids: idDigits(idText),
    };
  });
}

export interface OrgRow {
  seq: number; designatedTemp: string | null; designatedPerm: string | null; cancelled: boolean; note: string | null;
  nameHe: string | null; nameEn: string | null; nameAr: string | null; aliases: string[]; corpType: string | null;
  corpId: string | null; country: string | null; designation: string | null; justificationEn: string | null;
  linkedTo: number | null; ids: number[];
}

export function parseOrgs(rows: string[][]): OrgRow[] {
  const { one, all, data } = columns(rows);
  const c = {
    seq: one(/^internal seq\. id$/, "internal seq. id"), temp: one(/^date of temporary designation/, "Date of temporary designation"),
    perm: one(/^date of perm[ae]n[ae]nt designation/, "Date of permanent designation"),
    nameHe: one(/^organization name - hebrew$/, "Organization Name - Hebrew"), nameAr: one(/^organization name - arabic$/, "Organization Name - Arabic"),
    nameEn: one(/^organization name - english$/, "Organization Name - English"),
    aka: [...all(/^organization name - hebrew - aka/), ...all(/^organization name - arabic aka/), ...all(/^organization name - english - aka/)],
    corpType: one(/^corporation type - english$/, "Corporation Type - English"), corpId: one(/^corporation id$/, "Corporation ID"),
    country: one(/^country - english$/, "Country - English"), designation: one(/^designation type$/, "Designation Type"),
    justification: one(/^designation justification - english$/, "Designation Justification - English"), linkedTo: one(/^linked to/, "linked to"),
  };
  return data.map((r) => {
    const temp = designationCell(cell(r[c.temp]));
    const perm = designationCell(cell(r[c.perm]));
    const corpId = cell(r[c.corpId]);
    return {
      seq: digitsValue(cell(r[c.seq]))!, designatedTemp: temp.date, designatedPerm: perm.date, cancelled: temp.cancelled || perm.cancelled, note: temp.note ?? perm.note,
      nameHe: cell(r[c.nameHe]), nameEn: cell(r[c.nameEn]), nameAr: cell(r[c.nameAr]),
      aliases: c.aka.map((i) => cell(r[i])).filter((v): v is string => v !== null),
      corpType: cell(r[c.corpType]), corpId, country: cell(r[c.country]), designation: cell(r[c.designation]),
      justificationEn: cell(r[c.justification]), linkedTo: digitsValue(cell(r[c.linkedTo])), ids: idDigits(corpId),
    };
  });
}

/** Shared by both lists: the row table, its name index and its id digits, keyed by our own row id (the sheet's seq is not trusted to be unique). */
function fillNamesAndIds(db: RegistriesDb, table: string, rows: { names: (string | null)[]; ids: number[] }[]): void {
  db.exec(`create virtual table ${table}_names_new using fts5(names, ${FTS_OPTIONS}); create table ${table}_ids_new (row integer not null, digits integer not null)`);
  const name = db.prepare(`insert into ${table}_names_new (rowid, names) values (?, ?)`);
  const id = db.prepare(`insert into ${table}_ids_new values (?, ?)`);
  db.transaction(() => {
    rows.forEach((r, i) => {
      name.run(i + 1, normalizeName(r.names.filter(Boolean).join(" ")));
      for (const d of r.ids) id.run(i + 1, d);
    });
  })();
  db.exec(`create index ${indexName(`${table}_ids`)} on ${table}_ids_new (digits)`);
}

async function loadSheet(http: Http, url: string): Promise<{ rows: string[][]; dataDate: string | null }> {
  const { bytes, lastModified } = await fetchBytes(http, url);
  return { rows: readFirstSheet(bytes), dataDate: lastModified };
}

export const nbctfIndividuals: SourceDef = {
  id: "nbctf_individuals",
  tables: ["nbctf_individuals", "nbctf_individuals_names", "nbctf_individuals_ids"],
  async load(db, http): Promise<LoadResult> {
    const sheet = await loadSheet(http, NBCTF_INDIVIDUALS_URL);
    const rows = parseIndividuals(sheet.rows);
    db.exec("create table nbctf_individuals_new (id integer primary key, seq integer, designated text, cancelled integer not null, note text, name_en text, name_he text, name_ar text, nationality text, id_text text, dob text, designation text, designated_by text, foreign_designation text, info text)");
    const insert = db.prepare("insert into nbctf_individuals_new values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      rows.forEach((r, i) => insert.run(i + 1, r.seq, r.designated, r.cancelled ? 1 : 0, r.note, r.nameEn, r.nameHe, r.nameAr, r.nationality, r.idText, r.dob, r.designation, r.designatedBy, r.foreignDesignation, r.info));
    })();
    fillNamesAndIds(db, "nbctf_individuals", rows.map((r) => ({ names: [r.nameEn, r.nameHe, r.nameAr], ids: r.ids })));
    return { rowCount: rows.length, dataDate: sheet.dataDate };
  },
};

export const nbctfOrgs: SourceDef = {
  id: "nbctf_orgs",
  tables: ["nbctf_orgs", "nbctf_orgs_names", "nbctf_orgs_ids"],
  async load(db, http): Promise<LoadResult> {
    const sheet = await loadSheet(http, NBCTF_ORGS_URL);
    const rows = parseOrgs(sheet.rows);
    db.exec("create table nbctf_orgs_new (id integer primary key, seq integer, designated_temp text, designated_perm text, cancelled integer not null, note text, name_he text, name_en text, name_ar text, aliases text, corp_type text, corp_id text, country text, designation text, justification_en text, linked_to integer)");
    const insert = db.prepare("insert into nbctf_orgs_new values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      rows.forEach((r, i) => insert.run(i + 1, r.seq, r.designatedTemp, r.designatedPerm, r.cancelled ? 1 : 0, r.note, r.nameHe, r.nameEn, r.nameAr, r.aliases.join(" · ") || null, r.corpType, r.corpId, r.country, r.designation, r.justificationEn, r.linkedTo));
    })();
    fillNamesAndIds(db, "nbctf_orgs", rows.map((r) => ({ names: [r.nameHe, r.nameEn, r.nameAr, ...r.aliases], ids: r.ids })));
    return { rowCount: rows.length, dataDate: sheet.dataDate };
  },
};
