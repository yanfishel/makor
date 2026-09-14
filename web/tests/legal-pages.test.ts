import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "@/messages/en.json";
import he from "@/messages/he.json";
import { LegalPage } from "@/components/LegalPage";
import { CONTACT_EMAIL } from "@/lib/links";
import { LEGAL_DATE, formatLegalDate } from "@/lib/legal";

const render = (messages: typeof en, doc: "terms" | "privacy", locale: string) =>
  renderToStaticMarkup(createElement(LegalPage, { doc: messages.legal[doc], m: messages.legal, locale }));

describe("LegalPage", () => {
  it("numbers the sections, anchors them and shows the last-updated date", () => {
    const html = render(en, "terms", "en");
    expect(html).toContain(`<h1 class="text-3xl font-semibold tracking-tight">${en.legal.terms.title}</h1>`);
    en.legal.terms.sections.forEach((s, i) => {
      expect(html).toContain(`id="${s.id}"`);
      expect(html).toContain(`${i + 1}. ${s.title}`);
    });
    expect(html).toContain(formatLegalDate("en"));
    expect(formatLegalDate("en", "2026-09-13")).toBe("September 13, 2026");
  });
  it("fills the contact link and the locale's paths, leaving no placeholder behind", () => {
    for (const [messages, locale, prefix] of [[en, "en", ""], [he, "he", "/he"]] as const) {
      for (const doc of ["terms", "privacy"] as const) {
        const html = render(messages as typeof en, doc, locale);
        expect(html).toContain(`href="mailto:${CONTACT_EMAIL}"`);
        expect(html.replaceAll(`mailto:${CONTACT_EMAIL}`, "")).not.toContain(CONTACT_EMAIL); // a link, never the printed address
        expect(html).toContain(`href="${prefix}/${doc === "terms" ? "privacy" : "terms"}"`);
        expect(html).not.toMatch(/\{(email|terms|privacy|date)\}/);
      }
    }
  });
  it("keeps the same section ids, in the same order, in both languages", () => {
    for (const doc of ["terms", "privacy"] as const) {
      expect(he.legal[doc].sections.map((s) => s.id)).toEqual(en.legal[doc].sections.map((s) => s.id));
    }
  });
  it("names every cookie and storage key the app sets", () => {
    const cookies = en.legal.privacy.sections.find((s) => s.id === "cookies")!.items.join(" ");
    for (const name of ["NEXT_LOCALE", "sidebar_state", "theme", "Clerk"]) {
      expect(cookies).toContain(name);
      expect(he.legal.privacy.sections.find((s) => s.id === "cookies")!.items.join(" ")).toContain(name);
    }
  });
  it("dates the documents as an ISO day", () => {
    expect(LEGAL_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
