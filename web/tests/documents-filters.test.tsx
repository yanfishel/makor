import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { DocumentsFilters } from "@/components/DocumentsFilters";
import type { DocumentFacets } from "@/lib/documents";

const facets: DocumentFacets = { families: ["cheque", "teudat_zehut"], verdicts: ["verified"], backends: ["ollama"], sources: ["ui"] };
const render = (filters: Parameters<typeof DocumentsFilters>[0]["filters"]) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <DocumentsFilters filters={filters} facets={facets} locale="en" />
    </NextIntlClientProvider>,
  );

describe("DocumentsFilters", () => {
  it("is a GET form whose selects carry the URL parameter names and human labels for the facet values", () => {
    const html = render({});
    expect(html).toContain('method="get"');
    for (const name of ["type", "verdict", "status", "engine", "source", "from", "to"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('<option value="teudat_zehut">Teudat Zehut</option>');
    expect(html).toContain('<option value="verified">Verified</option>');
    expect(html).toContain('<option value="failed">Failed</option>');
    expect(html).toContain('<option value="ollama">Ollama</option>');
    expect(html).toContain('<option value="ui">Web</option>');
    expect(html).not.toContain("Reset");
    expect(html).not.toContain('type="date"');
    expect(html).toContain("All time");
  });
  it("preselects the active filters and offers a reset link", () => {
    const html = render({ family: "cheque", status: "ok", from: "2026-09-01" });
    expect(html).toContain('<option value="cheque" selected="">Cheque</option>');
    expect(html).toContain('<option value="ok" selected="">OK</option>');
    expect(html).toContain('value="2026-09-01"');
    expect(html).toContain('href="/app/documents"');
    expect(html).toContain("Reset");
  });
});
