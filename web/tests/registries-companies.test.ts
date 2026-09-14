import { describe, expect, it } from "vitest";
import { openRegistriesDb } from "@/lib/registries/db";
import { companies, loadCompanies, mapCompany } from "@/lib/registries/sources/companies";
import { COMPANY_RECORDS, companiesRoutes, companyRecord, httpOf, tmpRegistriesFile } from "./registries-fixtures";

describe("mapCompany", () => {
  it("keeps the displayed fields, gives back the quote the data writes as ~, and reads the date", () => {
    expect(mapCompany(COMPANY_RECORDS[0])).toEqual({
      number: 510000003, nameHe: 'דוגמה בע"מ', nameEn: "EXAMPLE LTD", corpType: "ישראלית חברה פרטית", status: "פעילה", description: null,
      violator: "מפרה", incorporated: "1996-09-13", city: "תל אביב - יפו", street: "הדוגמה", house: "5", zip: "6100000",
    });
  });
  it("skips a record with no company number", () => {
    expect(mapCompany(companyRecord(null, "x"))).toBeNull();
  });
});

describe("loadCompanies", () => {
  it("pages through the datastore until a short page and indexes both names", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    expect(await loadCompanies(db, httpOf(companiesRoutes(COMPANY_RECORDS, 2)), 2)).toEqual({ rowCount: 3, dataDate: "2026-09-12" });
    expect(db.prepare("select number from companies_new order by number").all()).toEqual([{ number: 510000003 }, { number: 510000011 }, { number: 510000029 }]);
    expect(db.prepare("select rowid from companies_names_new where companies_names_new match ?").all('"בעמ"*').length).toBe(3);
    expect(db.prepare("select rowid from companies_names_new where companies_names_new match ?").all('"example"*')).toEqual([{ rowid: 510000003 }]);
  });
  it("fails when the rows read differ from the datastore's total", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    await expect(loadCompanies(db, httpOf(companiesRoutes(COMPANY_RECORDS, 2, 4)), 2)).rejects.toThrow(/read 3 of 4/);
  });
  it("the source definition uses the default page size", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    expect(await companies.load(db, httpOf(companiesRoutes()))).toEqual({ rowCount: 3, dataDate: "2026-09-12" });
  });
});
