import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { RegistriesControls, RegistriesTable } from "@/components/RegistriesPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RegistriesStatusBody } from "@/lib/registries-handlers";

const body: RegistriesStatusBody = {
  running: true, runStartedAt: "2026-09-13T10:00:00.000Z",
  sources: [
    { id: "boi_accounts", status: "ok", dataDate: "2026-09-10", fetchedAt: "2026-09-13T10:00:02.000Z", rowCount: 13819, durationMs: 1400, error: null, startedAt: "2026-09-13T10:00:00.000Z" },
    { id: "boi_severe", status: "error", dataDate: null, fetchedAt: null, rowCount: null, durationMs: null, error: "HTTP 503", startedAt: "2026-09-13T10:00:03.000Z" },
    { id: "nbctf_individuals", status: "running", dataDate: null, fetchedAt: null, rowCount: null, durationMs: null, error: null, startedAt: "2026-09-13T10:00:04.000Z" },
    { id: "nbctf_orgs", status: "never", dataDate: null, fetchedAt: null, rowCount: null, durationMs: null, error: null, startedAt: null },
    { id: "companies", status: "interrupted", dataDate: null, fetchedAt: null, rowCount: null, durationMs: null, error: null, startedAt: "2026-09-12T10:00:00.000Z" },
  ],
};

describe("RegistriesTable", () => {
  it("shows every source with its state, data date, row count and error", () => {
    const html = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><TooltipProvider><RegistriesTable status={body} locale="en" /></TooltipProvider></NextIntlClientProvider>);
    for (const name of ["Bank of Israel: restricted accounts", "Bank of Israel: severely restricted corporations", "NBCTF: designated individuals", "NBCTF: designated organizations", "Registrar of Companies"]) expect(html).toContain(name);
    expect(html).toContain("10.09.2026");
    expect(html).toContain("13,819");
    expect(html).toContain("HTTP 503");
    for (const state of [">ok<", ">error<", ">running<", ">never<", ">interrupted<"]) expect(html).toContain(state);
  });
});

describe("RegistriesControls", () => {
  const renderControls = (isAdmin: boolean, checkEnabled: boolean, status: RegistriesStatusBody | null) => renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><RegistriesControls isAdmin={isAdmin} checkEnabled={checkEnabled} status={status} onRefresh={() => {}} /></NextIntlClientProvider>,
  );
  const nothing: RegistriesStatusBody = { ...body, running: false, sources: body.sources.map((s) => ({ ...s, fetchedAt: null })) };
  it("the refresh button and its guidance are for admins only", () => {
    expect(renderControls(true, false, body)).toContain("Refresh");
    expect(renderControls(false, false, body)).not.toContain("Refresh");
    expect(renderControls(false, false, body)).toContain("Public registries");
  });
  it("warns when the check is on and nothing was ever downloaded", () => {
    expect(renderControls(false, true, nothing)).toContain("have not been downloaded yet");
    expect(renderControls(false, true, body)).not.toContain("have not been downloaded yet");
    expect(renderControls(false, false, nothing)).not.toContain("have not been downloaded yet");
  });
});
