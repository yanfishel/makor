import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "@/messages/en.json";
import { SiteFooter } from "@/components/public/SiteFooter";
import { CONTACT_EMAIL, GITHUB_URL } from "@/lib/links";

const labels = { docs: "Docs", terms: "Terms of Use", privacy: "Privacy Policy", signIn: "Sign in", privacyNote: "Personal data…" };
const render = (locale: string) => renderToStaticMarkup(createElement(SiteFooter, { locale, labels, signature: en.signature }));
const html = render("en");
/** The footer's parts, in document order: the four columns, then the bottom line. */
const columns = html.slice(0, html.lastIndexOf("max-w-6xl"));
const bottom = html.slice(html.lastIndexOf("max-w-6xl"));

describe("SiteFooter", () => {
  it("puts the copyright and the privacy note in one paragraph under the Makor logo, without the made-with text", () => {
    const first = columns.slice(0, columns.indexOf("<ul"));
    expect(first).toMatch(new RegExp(`<p[^>]*><bdi>© ${new Date().getFullYear()} Makor</bdi>\\. ${labels.privacyNote}</p>`));
    expect(first).not.toContain("♥");
  });
  it("keeps Docs, GitHub and Sign in together, and the legal pages in their own column, in the locale", () => {
    const [, links, legal] = columns.split("<ul");
    expect(links).toContain('href="/api-reference"');
    expect(links).toContain(`href="${GITHUB_URL}"`);
    expect(links).not.toContain("/terms");
    expect(legal).toContain('href="/terms"');
    expect(legal).toContain('href="/privacy"');
    expect(columns).not.toContain('target="_blank"'); // the public pages' own links stay in the tab
    expect(render("he")).toContain('href="/he/privacy"');
  });
  it("aligns the language link to the end in the last column", () => {
    const last = columns.slice(columns.indexOf("justify-self-end"));
    expect(last).toContain('href="/he/"');
    expect(last).not.toContain("mailto:");
  });
  it("ends with fishart at the start, the made-with line in the middle and the contact icons at the end", () => {
    const logo = bottom.indexOf('href="https://fishart.co.il"');
    const made = bottom.indexOf("♥");
    const mail = bottom.indexOf(`href="mailto:${CONTACT_EMAIL}?subject=Makor%20feedback"`);
    expect(logo).toBeGreaterThan(-1);
    expect(made).toBeGreaterThan(logo);
    expect(mail).toBeGreaterThan(made);
    expect(bottom).toContain(`href="${GITHUB_URL}"`);
    expect(bottom).not.toContain("©");
    expect(bottom).toMatch(/max-w-6xl[^>]*>[^<]*<[^>]*border-t/);
  });
});
