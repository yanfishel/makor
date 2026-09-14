import { beforeAll, describe, expect, it } from "vitest";
import { openRegistriesDb, type RegistriesDb } from "@/lib/registries/db";
import { checkRegistries, parseSummary, summarizeCheck, type RegistriesCheck } from "@/lib/registries/check";
import { refreshSource } from "@/lib/registries/refresh";
import { SOURCES } from "@/lib/registries/sources";
import { boiSevere } from "@/lib/registries/sources/boi";
import { fixtureHttp, tmpRegistriesFile } from "./registries-fixtures";

const TODAY = "2026-09-13";
const f = (value: string) => ({ value, confidence: "high" });
const shape = (c: RegistriesCheck) => c.matches.map((m) => [m.level, m.source, m.by, m.field]);

describe("checkRegistries", () => {
  let db: RegistriesDb;
  beforeAll(async () => {
    db = openRegistriesDb(tmpRegistriesFile());
    for (const def of SOURCES) await refreshSource(db, def, fixtureHttp());
  });

  it("checks the holder's ID and name, the sefach spouse and children, alerts first", () => {
    const check = checkRegistries(db, {
      document_type: "teudat_zehut",
      fields: { id_number: f("1 2345678 2"), first_name_he: f("ג'ון"), last_name_he: f("דוגמה") },
      sefach: { spouse: { id_number: "200000008" }, children: [{ id_number: "510000011" }, { id_number: "510000029" }] },
    }, TODAY);
    expect(shape(check)).toEqual([
      ["alert", "nbctf_individuals", "id", "id_number"],
      ["alert", "boi_severe", "id", "spouse_id_number"],
      ["alert", "companies", "id", "child_id_number"],
      ["alert", "nbctf_individuals", "name", "name_he"],
      ["info", "companies", "id", "child_id_number"],
    ]);
    expect(check.sources.map((s) => [s.id, s.loaded])).toEqual([["boi_accounts", true], ["boi_severe", true], ["nbctf_individuals", true], ["nbctf_orgs", true], ["companies", true]]);
    expect(check.matches[0].record).toMatchObject({ seq: 1 });
    expect(check.checked).toEqual(["id_number", "spouse_id_number", "child_id_number", "name_he"]);
  });

  it("checks a cheque's drawer once even when the guarantor repeats it, and its account", () => {
    const check = checkRegistries(db, {
      fields: { drawer_id_number: f("510000003"), guarantor_id_number: f("510000003"), bank_code: f("11"), branch_number: f("148"), account_number: f("000123456") },
      sefach: null,
    }, TODAY);
    expect(shape(check)).toEqual([
      ["alert", "boi_severe", "id", "drawer_id_number"],
      ["alert", "nbctf_orgs", "id", "drawer_id_number"],
      ["alert", "boi_accounts", "account", "account"],
      ["info", "companies", "id", "drawer_id_number"],
    ]);
  });

  it("an active company is info even when it is a violator (מפרה); a struck-off one is an alert", () => {
    expect(shape(checkRegistries(db, { fields: { drawer_id_number: f("510000003") } }, TODAY)).filter((m) => m[1] === "companies")).toEqual([["info", "companies", "id", "drawer_id_number"]]);
    expect(shape(checkRegistries(db, { fields: { drawer_id_number: f("510000011") } }, TODAY))).toEqual([["alert", "companies", "id", "drawer_id_number"]]);
  });

  it("an expired account restriction is info; an account needs all three parts", () => {
    expect(shape(checkRegistries(db, { fields: { bank_code: f("10"), branch_number: f("1"), account_number: f("99") } }, TODAY))).toEqual([["info", "boi_accounts", "account", "account"]]);
    expect(checkRegistries(db, { fields: { bank_code: f("11"), account_number: f("123456") } }, TODAY).matches).toEqual([]);
  });

  it("names match whole words only, need both parts, and only against NBCTF individuals", () => {
    expect(shape(checkRegistries(db, { fields: { first_name_en: f("John"), last_name_en: f("Example") } }, TODAY))).toEqual([["alert", "nbctf_individuals", "name", "name_en"]]);
    expect(checkRegistries(db, { fields: { first_name_en: f("John"), last_name_en: f("Exam") } }, TODAY).matches).toEqual([]);
    expect(checkRegistries(db, { fields: { last_name_he: f("דוגמה") } }, TODAY).matches).toEqual([]);
  });

  it("ignores empty or non-numeric numbers and odd payloads", () => {
    expect(checkRegistries(db, { fields: { id_number: f(""), drawer_id_number: { value: null, confidence: "low" } } }, TODAY).matches).toEqual([]);
    expect(checkRegistries(db, null, TODAY).matches).toEqual([]);
  });

  it("checked is empty when the payload offers nothing to look up", () => {
    expect(checkRegistries(db, { document_type: "not_a_document", fields: {} }, TODAY).checked).toEqual([]);
    expect(checkRegistries(db, { fields: { id_number: f(""), last_name_he: f("דוגמה") } }, TODAY).checked).toEqual([]);
  });

  it("does not query a source that was never downloaded and reports it unloaded", async () => {
    const partial = openRegistriesDb(tmpRegistriesFile());
    await refreshSource(partial, boiSevere, fixtureHttp());
    const check = checkRegistries(partial, { fields: { id_number: f("510000003"), first_name_en: f("John"), last_name_en: f("Example") } }, TODAY);
    expect(shape(check)).toEqual([["alert", "boi_severe", "id", "id_number"]]);
    expect(check.sources.filter((s) => s.loaded).map((s) => s.id)).toEqual(["boi_severe"]);
    expect(check.checked).toEqual(["id_number"]); // the name's only source, NBCTF individuals, is not loaded
  });
});

describe("summarizeCheck / parseSummary", () => {
  const match = (level: "alert" | "info", source: "companies" | "nbctf_individuals", by: "id" | "name") =>
    ({ level, source, by, field: "id_number", record: {} }) as unknown as RegistriesCheck["matches"][number];
  it("counts per source and kind, split by level, with no values", () => {
    const summary = summarizeCheck({ sources: [], checked: ["id_number", "name_en"], matches: [match("alert", "nbctf_individuals", "name"), match("alert", "nbctf_individuals", "name"), match("info", "companies", "id")] });
    expect(summary).toEqual({ alerts: [{ source: "nbctf_individuals", by: "name", count: 2 }], infos: [{ source: "companies", by: "id", count: 1 }], checked: ["id_number", "name_en"] });
    expect(summarizeCheck({ sources: [], checked: [], matches: [] })).toEqual({ alerts: [], infos: [], checked: [] });
    expect(summarizeCheck({ error: "REGISTRIES_UNAVAILABLE" })).toEqual({ error: "REGISTRIES_UNAVAILABLE" });
  });
  it("parses what summarizeCheck wrote and nothing else", () => {
    expect(parseSummary(JSON.stringify({ alerts: [], infos: [], checked: ["account"] }))).toEqual({ alerts: [], infos: [], checked: ["account"] });
    expect(parseSummary(JSON.stringify({ alerts: [], infos: [], checked: [] }))).toEqual({ alerts: [], infos: [], checked: [] });
    // a row written before `checked` existed: accepted, checked unknown
    expect(parseSummary(JSON.stringify({ alerts: [], infos: [] }))).toEqual({ alerts: [], infos: [] });
    expect(parseSummary('{"error":"REGISTRIES_UNAVAILABLE"}')).toEqual({ error: "REGISTRIES_UNAVAILABLE" });
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary("not json")).toBeNull();
    expect(parseSummary('{"alerts":1}')).toBeNull();
    expect(parseSummary('{"alerts":[],"infos":[],"checked":"id_number"}')).toBeNull();
  });
});
