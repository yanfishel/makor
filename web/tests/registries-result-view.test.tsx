import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { TooltipProvider } from "@/components/ui/tooltip";
import en from "@/messages/en.json";
import { ResultView } from "@/components/ResultView";
import type { ExtractResponse } from "@/lib/result-types";

const result = (over: Partial<ExtractResponse> = {}): ExtractResponse => ({
  document_type: "cheque", fields: {}, validation: { overall: "unverified" }, warnings: [], regions: [], sefach: null, model: "anthropic/claude-opus-5",
  meta: { mode: "local", trial_remaining: null, backend: "anthropic", model: "claude-opus-5", document_id: "d1" }, ...over,
});
const render = (r: ExtractResponse) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><TooltipProvider><ResultView result={r} /></TooltipProvider></NextIntlClientProvider>,
);
const loaded = (["boi_accounts", "boi_severe", "nbctf_individuals", "nbctf_orgs", "companies"] as const).map((id) => ({ id, data_date: "2026-09-10", loaded: true }));

describe("ResultView — registries section", () => {
  it("absent when the check was off", () => {
    expect(render(result({ registries: null }))).not.toContain('data-slot="section-registries"');
    expect(render(result())).not.toContain('data-slot="section-registries"');
  });
  it("a match row: field label, source and kind, the record summary, the level pill; a name match asks to verify", () => {
    const html = render(result({ registries: { sources: loaded, checked: ["name_en"], matches: [
      { level: "alert", source: "nbctf_individuals", by: "name", field: "name_en", record: { seq: 1, nameEn: "JOHN EXAMPLE", nameHe: null, nameAr: null, nationality: null, idText: null, dob: null, designated: null, cancelled: false, note: null, designation: null } },
    ] } }));
    expect(html).toContain('data-slot="section-registries"');
    expect(html).toContain(">Registries<");
    expect(html).toContain("Name (English)");
    expect(html).toContain("NBCTF: designated individuals · by name · verify the details");
    expect(html).toContain("JOHN EXAMPLE");
    expect(html).toContain(">alert<");
  });
  it("the notes: not found, nothing looked up, a failed check", () => {
    expect(render(result({ registries: { sources: loaded, checked: ["id_number"], matches: [] } }))).toContain(">Not found<");
    const nothing = render(result({ registries: { sources: loaded, checked: [], matches: [] } }));
    expect(nothing).toContain("Nothing to look up");
    expect(nothing).not.toContain("Not found");
    expect(render(result({ registries: { error: "REGISTRIES_UNAVAILABLE" } }))).toContain("The registries check did not run");
  });
});
