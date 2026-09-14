import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { TooltipProvider } from "@/components/ui/tooltip";
import en from "@/messages/en.json";
import { ResultView } from "@/components/ResultView";
import { sefachSections } from "@/lib/sefach";
import type { ExtractResponse, Sefach, SefachAddress, SefachPerson } from "@/lib/result-types";

const f = (value: string | null, confidence: "high" | "medium" | "low" = "high") => ({ value, confidence });
const address = (over: Partial<SefachAddress> = {}): SefachAddress => ({
  street: null, house_number: null, entrance: null, apartment: null, city: null, postal_code: null, confidence: "high", ...over,
});
const person = (over: Partial<SefachPerson> = {}): SefachPerson => ({
  last_name_he: null, first_name_he: null, id_number: null, date_of_birth: null, sex: null, confidence: "high", ...over,
});
const sefach = (over: Partial<Sefach> = {}): Sefach => ({
  id_number: f("123456782"), last_name_he: f("כהן"), first_name_he: f("דוד"),
  previous_last_name_he: f(null), previous_first_name_he: f(null), maiden_name_he: f(null),
  father_name_he: f(null), mother_name_he: f(null), date_of_birth: f(null), place_of_birth: f(null),
  marital_status: f(null), nationality: f(null), date_of_issue: f(null),
  address: null, spouse: null, children: [], notes: null, marital_status_code: null, ...over,
});
const result = (over: Partial<ExtractResponse> = {}): ExtractResponse => ({
  document_type: "teudat_zehut",
  fields: { id_number: f("123456782"), last_name_he: f("כהן") },
  validation: { overall: "unverified" },
  warnings: [], regions: [], sefach: null, model: "ollama/qwen3-vl:8b-instruct",
  meta: { mode: "local", trial_remaining: null, backend: "ollama", model: "qwen3-vl:8b-instruct", document_id: "d1" },
  ...over,
});
const render = (r: ExtractResponse) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TooltipProvider><ResultView result={r} /></TooltipProvider>
    </NextIntlClientProvider>,
  );

describe("sefachSections", () => {
  it("names every row the way the API does, and carries a block's confidence onto each of its rows", () => {
    const [sheet, children] = sefachSections(sefach({
      address: address({ street: "יוחנן בן זכאי", house_number: "31", city: "ירושלים", confidence: "medium" }),
      marital_status: f("גרוש"),
      children: [person({ first_name_he: "רותי", id_number: "200000008", confidence: "low" })],
    }));
    expect(sheet.title).toBe("sefach");
    expect(sheet.rows.map((r) => r.name)).toEqual([
      "id_number", "last_name_he", "first_name_he", "marital_status",
      "address.street", "address.house_number", "address.city",
    ]);
    expect(sheet.rows.find((r) => r.name === "address.city")?.confidence).toBe("medium");
    expect(children.rows).toEqual([
      { name: "children[0].first_name_he", value: "רותי", confidence: "low" },
      { name: "children[0].id_number", value: "200000008", confidence: "low" },
    ]);
  });
  it("has no section for a sheet that read nothing, and none for a sheet without children", () => {
    expect(sefachSections(sefach({ id_number: f(null), last_name_he: f(null), first_name_he: f(null) }))).toEqual([]);
    expect(sefachSections(sefach()).map((s) => s.title)).toEqual(["sefach"]);
  });
});

describe("ResultView with a sefach", () => {
  it("continues the fields table: a full-width rule per section, then the sheet's own rows", () => {
    const html = render(result({ sefach: sefach({ address: address({ city: "ירושלים" }), children: [person({ first_name_he: "רותי" })] }) }));
    expect(html).toContain('data-slot="section-sefach"');
    expect(html).toContain('data-slot="section-children"');
    expect(html.toLowerCase()).toContain('colspan="3"');   // React 19 keeps the attribute's camel spelling; HTML is case-insensitive
    // The rows read as labels; the API's own name stays on the row (and in its tooltip) so a
    // line can still be found in the JSON tab.
    expect(html).toContain("City");
    expect(html).toContain("Child 1 · First name");
    expect(html).toContain('data-field="address.city"');
    expect(html).toContain('data-field="children[0].first_name_he"');
    expect(html.indexOf("last_name_he")).toBeLessThan(html.indexOf('data-slot="section-sefach"'));
    expect(html).not.toContain('value="sefach"');     // no tab of its own
  });
  it("puts the warnings first, then the type, the verdict and the download on one row", () => {
    const html = render(result({ warnings: ["The image is about 100 dpi"] }));
    // The caveats belong under the stages that produced them, before anything they qualify.
    expect(html.indexOf("The image is about 100 dpi")).toBeLessThan(html.indexOf("Teudat Zehut"));
    // One row over the table it describes: what the page turned out to be, how well it was
    // read, and the response to take away — the first and the last at the row's edges.
    expect(html.indexOf("Teudat Zehut")).toBeLessThan(html.indexOf("Unverified"));
    expect(html.indexOf("Unverified")).toBeLessThan(html.indexOf("Download JSON"));
    expect(html.indexOf("Download JSON")).toBeLessThan(html.indexOf('role="tablist"'));
    expect(html).not.toContain("Validation:");   // the pill says it without a label
  });
  it("leaves the table alone when the page carried no sheet", () => {
    const html = render(result());
    expect(html).not.toContain('data-slot="section-sefach"');
    expect(html).toContain('data-field="last_name_he"');
    expect(html).toContain("Family name");
  });
});
