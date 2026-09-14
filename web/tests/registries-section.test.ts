import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import { registriesRows, summaryTip, type Translate } from "@/lib/registries/section";
import type { RegistriesCheck } from "@/lib/registries/check";

const tc = createTranslator({ locale: "en", messages: en, namespace: "registries.check" }) as unknown as Translate;
const ts = createTranslator({ locale: "en", messages: en, namespace: "registries.sources" }) as unknown as Translate;

describe("summaryTip", () => {
  it("lists alerts, then infos, then the details pointer when a result is stored", () => {
    const summary = { alerts: [{ source: "nbctf_individuals", by: "name", count: 1 }], infos: [{ source: "companies", by: "id", count: 2 }] } as const;
    expect(summaryTip(summary as never, tc, ts, true)).toBe("NBCTF: designated individuals — by name (1)\ninfo: Registrar of Companies — by number (2)\ndetails on the document page");
    expect(summaryTip(summary as never, tc, ts, false)).toBe("NBCTF: designated individuals — by name (1)\ninfo: Registrar of Companies — by number (2)");
  });
  it("has nothing to say for an empty summary or an error", () => {
    expect(summaryTip({ alerts: [], infos: [] }, tc, ts, true)).toBeNull();
    expect(summaryTip({ error: "REGISTRIES_UNAVAILABLE" }, tc, ts, true)).toBeNull();
  });
});

const src = (loaded: boolean, date: string | null = "2026-09-10") =>
  (["boi_accounts", "boi_severe", "nbctf_individuals", "nbctf_orgs", "companies"] as const).map((id) => ({ id, data_date: loaded ? date : null, loaded }));

describe("registriesRows", () => {
  it("one row per match with a one-line record summary", () => {
    const check: RegistriesCheck = {
      sources: src(true),
      checked: ["id_number", "drawer_id_number", "account", "name_en"],
      matches: [
        { level: "alert", source: "companies", by: "id", field: "drawer_id_number", record: { number: 510000003, nameHe: "דוגמה בע\"מ", nameEn: "EXAMPLE LTD", corpType: null, status: "פעילה", violator: "מפרה", city: null } },
        { level: "alert", source: "boi_accounts", by: "account", field: "account", record: { bank: 11, branch: 148, account: 123456, startDate: "2024-01-01", endDate: "2027-01-01", active: true } },
        { level: "alert", source: "nbctf_individuals", by: "name", field: "name_en", record: { seq: 1, nameEn: "JOHN EXAMPLE", nameHe: null, nameAr: null, nationality: null, idText: null, dob: null, designated: "2026-09-10", cancelled: false, note: null, designation: "הכרזה" } },
        { level: "info", source: "boi_severe", by: "id", field: "id_number", record: { idNumber: 200000008, name: "עמותה", endDate: "2026-11-13" } },
      ],
    };
    expect(registriesRows(check, tc, "en")).toEqual([
      { kind: "match", field: "drawer_id_number", source: "companies", level: "alert", by: "id", summary: "510000003 · דוגמה בע\"מ · פעילה · מפרה" },
      { kind: "match", field: "account", source: "boi_accounts", level: "alert", by: "account", summary: "11 · Discount Bank · 148 · 123456 · 01.01.2024–01.01.2027" },
      { kind: "match", field: "name_en", source: "nbctf_individuals", level: "alert", by: "name", summary: "JOHN EXAMPLE · designated 10.09.2026 · הכרזה" },
      { kind: "match", field: "id_number", source: "boi_severe", level: "info", by: "id", summary: "200000008 · עמותה · until 13.11.2026" },
    ]);
  });
  it("a note when nothing was found, nothing was downloaded, or the check failed", () => {
    expect(registriesRows({ sources: src(true), checked: ["id_number"], matches: [] }, tc, "en")).toEqual([{ kind: "note", text: "Not found" }]);
    expect(registriesRows({ sources: src(false), checked: [], matches: [] }, tc, "en")).toEqual([{ kind: "note", text: "The registries have not been downloaded" }]);
    expect(registriesRows({ error: "REGISTRIES_UNAVAILABLE" }, tc, "en")).toEqual([{ kind: "note", text: "The registries check did not run" }]);
  });
  it("'not found' carries no dates or sources, even when some sources are not downloaded", () => {
    const partial = src(true).map((s) => (s.id === "nbctf_individuals" || s.id === "companies" ? { ...s, data_date: null, loaded: false } : s));
    expect(registriesRows({ sources: partial, checked: ["id_number"], matches: [] }, tc, "en")).toEqual([{ kind: "note", text: "Not found" }]);
    const rows = registriesRows({ sources: partial, checked: ["id_number"], matches: [
      { level: "info", source: "boi_severe", by: "id", field: "id_number", record: { idNumber: 200000008, name: "עמותה", endDate: "2026-11-13" } },
    ] }, tc, "en");
    expect(rows.map((r) => r.kind)).toEqual(["match"]);
  });
  it("says nothing was looked up instead of 'not found' when checked is empty", () => {
    expect(registriesRows({ sources: src(true), checked: [], matches: [] }, tc, "en")).toEqual([{ kind: "note", text: "Nothing to look up — no number, account or full name was read" }]);
    // a result stored before `checked` existed carries none: rendered as a check that ran
    expect(registriesRows({ sources: src(true), matches: [] } as unknown as RegistriesCheck, tc, "en")).toEqual([{ kind: "note", text: "Not found" }]);
  });
});
