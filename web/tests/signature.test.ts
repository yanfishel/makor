import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "@/messages/en.json";
import { Signature } from "@/components/Signature";
import { CONTACT_EMAIL, GITHUB_URL } from "@/lib/links";

describe("Signature", () => {
  const html = renderToStaticMarkup(createElement(Signature, { labels: en.signature, locale: "en" }));
  it("keeps the e-mail and GitHub icon links", () => {
    expect(html).toContain(`href="mailto:${CONTACT_EMAIL}?subject=Makor%20feedback"`);
    expect(html).toContain(`href="${GITHUB_URL}"`);
  });
  it("links the Terms of Use and the Privacy Policy in the locale, beside a short copyright", () => {
    // The app's footer leaves the app, so the legal pages open in a new tab.
    expect(html).toMatch(new RegExp(`href="/terms" target="_blank" rel="noopener"[^>]*>${en.signature.terms}</a>`));
    expect(html).toMatch(new RegExp(`href="/privacy" target="_blank" rel="noopener"[^>]*>${en.signature.privacy}</a>`));
    expect(html).toContain(`© ${new Date().getFullYear()} Makor`);
    const he = renderToStaticMarkup(createElement(Signature, { labels: en.signature, locale: "he" }));
    expect(he).toContain('href="/he/terms"');
    expect(he).toContain('href="/he/privacy"');
  });
  it("drops the fishart logo and the made-with line from the app", () => {
    expect(html).not.toContain("fishart");
    expect(html).not.toContain("♥");
  });
});
