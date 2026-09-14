import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DocumentsTable } from "@/components/DocumentsTable";

/* The row click navigates through the app router, which a static render has no instance of. */
vi.mock("@/i18n/routing", async (orig) => ({ ...(await orig<typeof import("@/i18n/routing")>()), useRouter: () => ({ push: () => {} }) }));
import type { DocumentMeta } from "@/lib/documents";

const row = (over: Partial<DocumentMeta>): DocumentMeta => ({
  id: "d1", createdAt: "2026-09-06T12:00:00Z", status: 200, docType: "cheque", verdict: "partial", sefach: false, mode: "trial", source: "ui",
  backend: "anthropic", model: "claude-opus-5", tokensIn: 1500, tokensOut: 400, tokensCached: 0, latencyMs: 21000, costUsd: 0.0452, errorCode: null, hasResult: false, registries: null, ...over,
});
const render = (rows: DocumentMeta[]) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TooltipProvider>
        <DocumentsTable rows={rows} locale="en" />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );

describe("DocumentsTable", () => {
  it("shows tokens as in / out and the cost after latency", () => {
    const html = render([row({})]);
    expect(html.indexOf("Latency")).toBeLessThan(html.indexOf("Tokens"));
    expect(html.indexOf("Tokens")).toBeLessThan(html.indexOf("Cost"));
    expect(html).toContain("1,500 / 400");
    expect(html).toContain("$0.045");
  });
  it("shows a dash for the cost of an ollama document", () => {
    const html = render([row({ backend: "ollama", costUsd: null })]);
    expect(html).toContain("1,500 / 400");
    expect(html.match(/—/g)?.length).toBeGreaterThanOrEqual(1);
  });
  it("labels the document family, verdict, status, engine and source for humans", () => {
    const html = render([row({ docType: "cheque_back", verdict: "verified", backend: "ollama", model: "qwen3-vl:8b-instruct", source: "api" })]);
    expect(html).toContain(">Cheque<");
    expect(html).not.toContain(">cheque_back<");
    expect(html).toContain('data-tip="cheque_back"'); // the region type stays reachable as the chip's tooltip
    expect(html).toContain(">Verified<");
    expect(html).toContain(">OK<");
    expect(html).toContain(">Ollama<");
    expect(html).toContain('data-tip="qwen3-vl:8b-instruct"');
    expect(html).toContain(">API<");
    expect(html).toContain("text-doc-cheque");
    expect(html).toContain("text-engine-ollama");
    expect(html).toContain("text-source-api");
  });
  it("keeps the status short and puts the error code in the title", () => {
    const html = render([row({ status: 502, errorCode: "ENGINE_ERROR" })]);
    expect(html).toContain(">Failed<");
    expect(html).toContain('data-tip="ENGINE_ERROR"');
    expect(html).not.toContain("failed · ");
  });
  it("makes a row with a stored result clickable and links nothing", () => {
    const stored = render([row({ hasResult: true })]);
    expect(stored).not.toContain("<a ");
    expect(stored).toContain("cursor-pointer");
    expect(stored).toContain('data-href="/app/documents/d1"');
    const plain = render([row({ hasResult: false })]);
    expect(plain).not.toContain("cursor-pointer");
    expect(plain).not.toContain("data-href");
  });
  it("renders the date without the UTC suffix and with the full timestamp as its tooltip", () => {
    const html = render([row({})]);
    expect(html).not.toContain("UTC");
    expect(html).toContain('data-tip="2026-09-06T12:00:00Z"');
  });
  it("says so when there are no rows", () => {
    expect(render([])).toContain(en.dashboard.empty);
  });
  it("registries column: a match pill with the summary as its tip, an info pill for info-only matches, a warning on error, nothing when unchecked", () => {
    const html = render([
      row({ id: "a", registries: { alerts: [{ source: "boi_accounts", by: "account", count: 1 }], infos: [] } }),
      row({ id: "b", registries: { alerts: [], infos: [{ source: "companies", by: "id", count: 1 }] } }),
      row({ id: "c", registries: { error: "REGISTRIES_UNAVAILABLE" } }),
      row({ id: "d", registries: null }),
    ]);
    expect(html.indexOf("Verdict")).toBeLessThan(html.indexOf("Registries"));
    expect(html).toContain(">match<");
    expect(html).toContain('data-tip="Bank of Israel: restricted accounts — by account (1)"');
    expect(html).toContain('data-tip="info: Registrar of Companies — by number (1)"');
    const infoCell = html.split("<tr")[3].split("<td")[4];
    expect(infoCell).toContain(">info<");
    expect(infoCell).not.toContain(">—<");
    expect(html).toContain(">check failed<");
  });
  it("registries column: a check that looked nothing up is an empty cell, not a clean dash; an old row without checked keeps the dash", () => {
    // the fourth cell of the only row, up to the next cell
    const cells = (registries: DocumentMeta["registries"]) => render([row({ registries })]).split("<td")[4];
    expect(cells({ alerts: [{ source: "boi_accounts", by: "account", count: 1 }], infos: [], checked: ["account"] })).toContain(">match<");
    expect(cells({ alerts: [], infos: [], checked: [] })).not.toContain("—");
    expect(cells({ alerts: [], infos: [], checked: ["id_number"] })).toContain("—");
    expect(cells({ alerts: [], infos: [] })).toContain("—");
  });
});
