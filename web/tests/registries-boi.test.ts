import { describe, expect, it } from "vitest";
import { openRegistriesDb } from "@/lib/registries/db";
import { BOI_LISTING_URL, boiAccounts, boiSevere, decodeBoiText, parseAccounts, parseSevere } from "@/lib/registries/sources/boi";
import { ACCOUNTS_TXT, SEVERE_TXT, boiRoutes, cp1255, httpOf, jsonResponse, tmpRegistriesFile } from "./registries-fixtures";

describe("parseAccounts", () => {
  it("reads the header date and every fixed-width field", () => {
    const { header, rows } = parseAccounts(ACCOUNTS_TXT);
    expect(header).toEqual({ dataDate: "2026-09-10", lineCount: 3 });
    expect(rows).toEqual([
      { bank: 11, branch: 148, account: 123456, startDate: "2024-01-01", endDate: "2027-01-01" },
      { bank: 10, branch: 1, account: 99, startDate: "2025-05-05", endDate: "2026-05-05" },
    ]);
  });
  it("fails when the header's line count disagrees with the file", () => {
    expect(() => parseAccounts(ACCOUNTS_TXT.replace("000003", "000004"))).toThrow(/line count/);
  });
  it("fails on a malformed line instead of skipping it", () => {
    expect(() => parseAccounts(ACCOUNTS_TXT.replace("0111148", "01x1148"))).toThrow(/line 2/);
  });
  it("fails on an unrecognised header", () => {
    expect(() => parseAccounts("hello\r\n")).toThrow(/header/);
  });
});

describe("parseSevere", () => {
  it("decodes Windows-1255 and reads id, end date and the trimmed name", () => {
    const { header, rows } = parseSevere(decodeBoiText(cp1255(SEVERE_TXT)));
    expect(header.dataDate).toBe("2026-09-10");
    expect(rows).toEqual([
      { idNumber: 510000003, name: "דוגמה סחר בעמ", endDate: "2028-05-01" },
      { idNumber: 200000008, name: "עמותה", endDate: "2026-11-13" },
    ]);
  });
});

describe("Bank of Israel loaders", () => {
  it("find both files through the listing and fill the _new tables", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    const http = httpOf(boiRoutes());
    expect(await boiAccounts.load(db, http)).toEqual({ rowCount: 2, dataDate: "2026-09-10" });
    expect(db.prepare("select bank, branch, account from boi_accounts_new order by bank").all()).toEqual([{ bank: 10, branch: 1, account: 99 }, { bank: 11, branch: 148, account: 123456 }]);
    expect(await boiSevere.load(db, http)).toEqual({ rowCount: 2, dataDate: "2026-09-10" });
    expect(db.prepare("select id_number from boi_severe_new where id in (select rowid from boi_severe_names_new where boi_severe_names_new match ?)").all('"דוגמ"*')).toEqual([{ id_number: 510000003 }]);
  });
  it("fail when the listing no longer names the file", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    const http = httpOf({ ...boiRoutes(), [BOI_LISTING_URL]: () => jsonResponse({ topFilesInfo: [], buttomFilesInfo: [] }) });
    await expect(boiAccounts.load(db, http)).rejects.toThrow(/WHPRSM02 is not listed/);
  });
});
