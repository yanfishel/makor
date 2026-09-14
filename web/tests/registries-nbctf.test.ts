import { describe, expect, it } from "vitest";
import { openRegistriesDb } from "@/lib/registries/db";
import { idDigits, nbctfIndividuals, nbctfOrgs, parseIndividuals, parseOrgs } from "@/lib/registries/sources/nbctf";
import { readFirstSheet } from "@/lib/registries/xlsx";
import { INDIVIDUALS_SHEET, ORGS_SHEET, buildXlsx, httpOf, nbctfRoutes, tmpRegistriesFile } from "./registries-fixtures";

const sheet = (rows: (string | number | null)[][]) => readFirstSheet(buildXlsx(rows));
const reversed = (rows: (string | number | null)[][]) => rows.map((r) => [...r].reverse());

describe("idDigits", () => {
  it("takes every run of five or more digits out of free text, once each", () => {
    expect(idDigits('ת"ז: 123456782; passport A1234567, 123456782, code 12')).toEqual([123456782, 1234567]);
    expect(idDigits(null)).toEqual([]);
  });
});

describe("parseIndividuals", () => {
  const expected = [
    { seq: 1, designated: "2026-09-10", cancelled: false, note: null, nameEn: "JOHN EXAMPLE", nameHe: "ג'ון דוגמה", nameAr: null, nationality: null, idText: 'ת"ז: 123456782; passport A1234567', dob: "1970-02-01", designation: "הכרזה לדוגמה", designatedBy: null, foreignDesignation: null, info: null, ids: [123456782, 1234567] },
    { seq: 2, designated: null, cancelled: true, note: "בוטל ביום 1.1.2020", nameEn: null, nameHe: null, nameAr: "مثال", nationality: null, idText: null, dob: null, designation: null, designatedBy: null, foreignDesignation: null, info: null, ids: [] },
  ];
  it("finds columns by their English header, maps placeholders to null and keeps a cancellation note", () => {
    expect(parseIndividuals(sheet(INDIVIDUALS_SHEET))).toEqual(expected);
  });
  it("does not depend on column order", () => {
    expect(parseIndividuals(sheet(reversed(INDIVIDUALS_SHEET)))).toEqual(expected);
  });
  it("fails loudly when a required column is gone", () => {
    const col = INDIVIDUALS_SHEET[1].indexOf("Name of Individual - Hebrew");
    expect(() => parseIndividuals(sheet(INDIVIDUALS_SHEET.map((r) => r.filter((_, i) => i !== col))))).toThrow(/Name of Individual - Hebrew/);
  });
  it("fails when there is no header row at all", () => {
    expect(() => parseIndividuals(sheet([["a", "b"]]))).toThrow(/header row/);
  });
});

describe("parseOrgs", () => {
  it("collects every aka column and the corporation number", () => {
    expect(parseOrgs(sheet(ORGS_SHEET))).toEqual([{
      seq: 7, designatedTemp: "2026-03-25", designatedPerm: null, cancelled: false, note: null, nameHe: "קרן דוגמה", nameEn: "EXAMPLE FUND", nameAr: null,
      aliases: ["הקרן", "EXAMPLE-FUND LTD"], corpType: "Company", corpId: "510000003", country: "United Kingdom", designation: "הכרזה", justificationEn: "Example", linkedTo: 3, ids: [510000003],
    }]);
  });
});

describe("NBCTF loaders", () => {
  it("fill rows, names and ids, with the Last-Modified date as the data date", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    const http = httpOf(nbctfRoutes());
    expect(await nbctfIndividuals.load(db, http)).toEqual({ rowCount: 2, dataDate: "2026-07-02" });
    expect(db.prepare("select seq from nbctf_individuals_new where id in (select row from nbctf_individuals_ids_new where digits = ?)").all(123456782)).toEqual([{ seq: 1 }]);
    expect(db.prepare("select rowid from nbctf_individuals_names_new where nbctf_individuals_names_new match ?").all('"גון"*')).toEqual([{ rowid: 1 }]);
    expect(await nbctfOrgs.load(db, http)).toEqual({ rowCount: 1, dataDate: "2026-07-02" });
    expect(db.prepare("select rowid from nbctf_orgs_names_new where nbctf_orgs_names_new match ?").all('"example" "fund"*')).toEqual([{ rowid: 1 }]);
  });
});
