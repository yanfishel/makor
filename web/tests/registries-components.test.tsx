import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { RegistryResults } from "@/components/registries/RegistryResults";
import { RegistrySearchForm } from "@/components/registries/RegistrySearchForm";
import type { SourceId, SourceStatus } from "@/lib/registries/db";
import type { CompanyHit, SearchResult } from "@/lib/registries/search";

const render = (node: ReactNode) => renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">{node}</NextIntlClientProvider>);
const ok = (id: SourceId): SourceStatus => ({ id, status: "ok", dataDate: "2026-09-10", fetchedAt: "2026-09-13T10:00:00.000Z", rowCount: 1, durationMs: 5, error: null, startedAt: "2026-09-13T09:59:59.000Z" });
const company = (n: number): CompanyHit => ({ number: n, nameHe: "דוגמה", nameEn: "EXAMPLE LTD", corpType: "ישראלית חברה פרטית", status: "פעילה", violator: null, city: "חיפה" });
const empty = { id: "", bank: "", branch: "", account: "", name: "" };

describe("RegistrySearchForm", () => {
  it("is a GET form with every field, the current values and a reset link", () => {
    const html = render(<RegistrySearchForm values={{ ...empty, id: "510000003", bank: "11" }} locale="en" />);
    expect(html).toContain('method="get"');
    for (const name of ["id", "bank", "branch", "account", "name"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('value="510000003"');
    expect(html).toMatch(/<option value="11" selected="">11 · Discount Bank<\/option>/);
    expect(html).toContain("Reset");
  });
  it("groups the fields by what they look up: a person or company, and a bank account", () => {
    const html = render(<RegistrySearchForm values={empty} locale="en" />);
    const groups = html.split("<fieldset").slice(1);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain("Person or company");
    for (const name of ["id", "name"]) expect(groups[0]).toContain(`name="${name}"`);
    expect(groups[0]).not.toContain('name="bank"');
    expect(groups[0].indexOf('name="id"')).toBeLessThan(groups[0].indexOf('name="name"'));
    expect(groups[1]).toContain("Bank account");
    for (const name of ["bank", "branch", "account"]) expect(groups[1]).toContain(`name="${name}"`);
    expect(groups[1]).not.toContain('name="id"');
  });
  it("offers no reset link on an empty form", () => {
    expect(render(<RegistrySearchForm values={empty} locale="en" />)).not.toContain("Reset");
  });
});

describe("RegistryResults", () => {
  it("renders a group per source with its count, data date and rows", () => {
    const result: SearchResult = { groups: [{ source: "companies", status: ok("companies"), loaded: true, total: 1, rows: [company(510000003)], nameOnly: false }], skipped: [] };
    const html = render(<RegistryResults result={result} locale="en" />);
    expect(html).toContain("Registrar of Companies");
    expect(html).toContain("Matches: 1");
    expect(html).toContain("data as of 10.09.2026");
    expect(html).toContain("510000003");
    expect(html).toContain("EXAMPLE LTD");
  });
  it("lists skipped sources with the fields they lack", () => {
    const html = render(<RegistryResults result={{ groups: [], skipped: [{ source: "boi_accounts", missing: ["id", "name"] }] }} locale="en" />);
    expect(html).toContain("Not searched: Bank of Israel: restricted accounts (has no ID / company number, Name).");
  });
  it("flags a name-only NBCTF group, a capped group, an active restriction and a source not downloaded", () => {
    const result: SearchResult = {
      groups: [
        { source: "boi_accounts", status: ok("boi_accounts"), loaded: true, total: 1, rows: [{ bank: 11, branch: 148, account: 123456, startDate: "2024-01-01", endDate: "2027-01-01", active: true }], nameOnly: false },
        { source: "nbctf_individuals", status: ok("nbctf_individuals"), loaded: true, total: 1, rows: [{ seq: 1, nameEn: "JOHN EXAMPLE", nameHe: null, nameAr: null, nationality: null, idText: null, dob: null, designated: null, cancelled: true, note: "בוטל", designation: null }], nameOnly: true },
        { source: "companies", status: ok("companies"), loaded: true, total: 60, rows: Array.from({ length: 50 }, (_, i) => company(520000000 + i)), nameOnly: false },
        { source: "nbctf_orgs", status: { ...ok("nbctf_orgs"), status: "never", fetchedAt: null }, loaded: false, total: 0, rows: [], nameOnly: true },
      ],
      skipped: [],
    };
    const html = render(<RegistryResults result={result} locale="en" />);
    expect(html).toContain("11 · Discount Bank");
    expect(html).toContain(">active<");
    expect(html).toContain("Matched by name only");
    expect(html).toContain(">cancelled<");
    expect(html).toContain("Showing 50 of 60. Narrow the search.");
    expect(html).toContain("Not downloaded yet.");
  });
  it("says no matches for a loaded source with none", () => {
    const html = render(<RegistryResults result={{ groups: [{ source: "boi_severe", status: ok("boi_severe"), loaded: true, total: 0, rows: [], nameOnly: false }], skipped: [] }} locale="en" />);
    expect(html).toContain("No matches.");
  });
  it("warns that the last refresh failed for a group still serving its previous data", () => {
    const result: SearchResult = { groups: [{ source: "companies", status: { ...ok("companies"), status: "error", error: "HTTP 503" }, loaded: true, total: 1, rows: [company(510000003)], nameOnly: false }], skipped: [] };
    const html = render(<RegistryResults result={result} locale="en" />);
    expect(html).toContain("The last download failed");
  });
});
