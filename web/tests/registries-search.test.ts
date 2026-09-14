import { beforeAll, describe, expect, it } from "vitest";
import { openRegistriesDb, type RegistriesDb } from "@/lib/registries/db";
import { bankLabel, BANK_CODES } from "@/lib/registries/banks";
import { refreshSource } from "@/lib/registries/refresh";
import { applicability, parseQuery, querySource, RESULT_LIMIT, searchRegistries, type ResultGroup } from "@/lib/registries/search";
import { SOURCES } from "@/lib/registries/sources";
import { boiSevere } from "@/lib/registries/sources/boi";
import { companies } from "@/lib/registries/sources/companies";
import { companiesRoutes, companyRecord, fixtureHttp, httpOf, tmpRegistriesFile } from "./registries-fixtures";

const TODAY = "2026-09-13";
const group = (groups: ResultGroup[], source: ResultGroup["source"]) => groups.find((g) => g.source === source);
/** A valid ח.פ. / ת.ז. from an 8-digit base: the check digit completes the Luhn-style sum. */
const withCheckDigit = (base: number) => {
  const s = String(base).padStart(8, "0");
  let sum = 0;
  for (let i = 0; i < 8; i++) { const d = Number(s[i]) * (i % 2 ? 2 : 1); sum += d > 9 ? d - 9 : d; }
  return Number(s + ((10 - (sum % 10)) % 10));
};

describe("parseQuery", () => {
  it("normalises every field and records which ones are filled", () => {
    const p = parseQuery({ id: "51-000000-3", bank: "11", branch: "", account: "", name: "" });
    expect(p.query).toEqual({ id: 510000003, bank: 11, branch: null, account: null, name: [] });
    expect(p.filled).toEqual(["id", "bank"]);
    expect(p.values.id).toBe("51-000000-3");
    expect(p.valid).toBe(true);
  });
  it("needs a number, an account or two letters of a name; bank and branch only narrow", () => {
    expect(parseQuery({ bank: "11", branch: "148" })).toMatchObject({ valid: false, empty: false });
    expect(parseQuery({ name: "א" }).valid).toBe(false);
    expect(parseQuery({})).toMatchObject({ valid: false, empty: true });
    expect(parseQuery({ account: "000123456" }).query.account).toBe(123456);
  });
  it("splits the name into normalised words and takes the first of repeated parameters", () => {
    expect(parseQuery({ name: '  חברה  בע"מ ' }).query.name).toEqual(["חברה", "בעמ"]);
    expect(parseQuery({ id: ["123456782", "200000008"] }).query.id).toBe(123456782);
  });
});

describe("applicability", () => {
  it("searches a source only when it carries every filled field", () => {
    expect(applicability(["id", "name"])).toEqual({
      searched: ["boi_severe", "nbctf_individuals", "nbctf_orgs", "companies"],
      skipped: [{ source: "boi_accounts", missing: ["id", "name"] }],
    });
    expect(applicability(["bank", "account"]).searched).toEqual(["boi_accounts"]);
    expect(applicability(["id", "account"]).searched).toEqual([]);
  });
});

describe("searchRegistries", () => {
  let db: RegistriesDb;
  beforeAll(async () => {
    db = openRegistriesDb(tmpRegistriesFile());
    for (const def of SOURCES) await refreshSource(db, def, fixtureHttp());
  });
  const search = (params: Record<string, string>) => searchRegistries(db, parseQuery(params), TODAY);

  it("a number finds the company, the severe restriction and the NBCTF organisation by its ids table", () => {
    const { groups } = search({ id: "510000003" });
    expect(group(groups, "companies")).toMatchObject({ total: 1, loaded: true, rows: [{ number: 510000003, nameHe: 'דוגמה בע"מ', violator: "מפרה" }] });
    expect(group(groups, "boi_severe")).toMatchObject({ total: 1, rows: [{ idNumber: 510000003 }] });
    expect(group(groups, "nbctf_orgs")).toMatchObject({ total: 1, nameOnly: false, rows: [{ seq: 7, corpId: "510000003" }] });
    expect(group(groups, "nbctf_individuals")?.total).toBe(0);
    expect(search({ id: "123456782" }).groups.find((g) => g.source === "nbctf_individuals")).toMatchObject({ total: 1, rows: [{ seq: 1, cancelled: false }] });
  });

  it("lists the sources that found something first, the rest after, each part in source order", () => {
    // the number is only in the NBCTF individuals list, which comes after boi_severe in source order
    expect(search({ id: "123456782" }).groups.map((g) => [g.source, g.total])).toEqual([
      ["nbctf_individuals", 1], ["boi_severe", 0], ["nbctf_orgs", 0], ["companies", 0],
    ]);
  });

  it("an account ANDs bank and branch, and marks a restriction active against today", () => {
    expect(group(search({ bank: "11", branch: "148", account: "123456" }).groups, "boi_accounts")).toMatchObject({ total: 1, rows: [{ bank: 11, active: true }] });
    expect(group(search({ bank: "10", account: "123456" }).groups, "boi_accounts")?.total).toBe(0);
    expect(group(search({ account: "99" }).groups, "boi_accounts")).toMatchObject({ total: 1, rows: [{ active: false }] });
  });

  it("a name is ANDed prefix words over every script; NBCTF rows matched by name only are flagged", () => {
    const { groups } = search({ name: "דוגמ" });
    expect(group(groups, "companies")?.total).toBe(1);
    expect(group(groups, "boi_severe")?.total).toBe(1);
    expect(group(groups, "nbctf_orgs")?.total).toBe(1);
    expect(group(groups, "nbctf_individuals")).toMatchObject({ total: 1, nameOnly: true });
    expect(group(search({ name: "example fund" }).groups, "nbctf_orgs")?.total).toBe(1);
    expect(group(search({ name: "example zzz" }).groups, "nbctf_orgs")?.total).toBe(0);
    expect(group(search({ name: "גון" }).groups, "nbctf_individuals")?.total).toBe(1);
  });

  it("ANDs a number with a name inside one source", () => {
    expect(group(search({ id: "510000003", name: "zzz" }).groups, "companies")?.total).toBe(0);
  });

  it("lists skipped sources and searches none when no source carries all fields", () => {
    const r = search({ id: "510000003", account: "123456" });
    expect(r.groups).toEqual([]);
    expect(r.skipped.map((s) => s.source)).toEqual(["boi_accounts", "boi_severe", "nbctf_individuals", "nbctf_orgs", "companies"]);
  });

  it("FTS syntax typed into the name cannot break the query", () => {
    expect(() => search({ name: 'NEAR( "x OR * AND:' })).not.toThrow();
  });

  it("runs no query and reports nothing skipped for an invalid query", () => {
    expect(search({ bank: "11", branch: "148" })).toEqual({ groups: [], skipped: [] });
  });

  it("querySource: exact names need whole words, prefixes still work by default, and limit caps rows but not total", () => {
    const q = (name: string) => parseQuery({ name }).query;
    expect(querySource(db, "nbctf_individuals", q("גון דוגמה"), TODAY, { exactName: true }).total).toBe(1);
    expect(querySource(db, "nbctf_individuals", q("גון דוגמ"), TODAY, { exactName: true }).total).toBe(0);
    expect(querySource(db, "nbctf_individuals", q("גון דוגמ"), TODAY).total).toBe(1);
    const all = querySource(db, "companies", q("בעמ"), TODAY, { limit: 1 });
    expect(all.total).toBe(3);
    expect(all.rows).toHaveLength(1);
  });
});

describe("searchRegistries on partial data", () => {
  it("caps rows at RESULT_LIMIT and still reports the true total", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    const records = Array.from({ length: RESULT_LIMIT + 10 }, (_, i) => companyRecord(withCheckDigit(52000000 + i), `חברת בדיקה ${i}`));
    await refreshSource(db, companies, httpOf(companiesRoutes(records)));
    const g = group(searchRegistries(db, parseQuery({ name: "בדיקה" }), TODAY).groups, "companies");
    expect(g).toMatchObject({ total: RESULT_LIMIT + 10 });
    expect(g?.rows).toHaveLength(RESULT_LIMIT);
  });

  it("reports a source that was never downloaded as not loaded instead of querying it", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    await refreshSource(db, boiSevere, fixtureHttp());
    const { groups } = searchRegistries(db, parseQuery({ id: "510000003" }), TODAY);
    expect(group(groups, "boi_severe")).toMatchObject({ loaded: true, total: 1 });
    expect(group(groups, "companies")).toMatchObject({ loaded: false, total: 0, rows: [] });
  });
});

describe("bankLabel", () => {
  it("names a known bank in the page's language and falls back to the code", () => {
    expect(bankLabel(12, "en")).toBe("12 · Bank Hapoalim");
    expect(bankLabel(12, "he")).toBe("12 · בנק הפועלים");
    expect(bankLabel(99, "en")).toBe("99");
    expect(BANK_CODES[0]).toBe(4);
  });
});
