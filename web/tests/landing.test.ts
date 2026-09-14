import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "@/messages/en.json";
import he from "@/messages/he.json";
import { Landing } from "@/components/landing/Landing";
import { READ_TYPES } from "@/components/landing/read-types";
import { CONTACT_EMAIL } from "@/lib/links";
import { CHECK_FIELDS } from "@/lib/registries/check";

const render = (m: typeof en.landing, locale: string) =>
  renderToStaticMarkup(createElement(Landing, { m, locale, siteUrl: "https://makor.example", trialDocs: 5, githubUrl: "https://github.com/x/y", signature: en.signature }));

describe("Landing", () => {
  it("keeps READ_TYPES index-aligned with reads.types in every locale", () => {
    expect(READ_TYPES).toHaveLength(en.landing.reads.types.length);
    expect(READ_TYPES).toHaveLength(he.landing.reads.types.length);
  });

  it("renders the spec's sections in order with the CTAs", () => {
    const html = render(en.landing, "en");
    const order = ["hero", "how", "reads", "registries", "privacy", "ways", "api", "footer"].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(`href="mailto:${CONTACT_EMAIL}?subject=Makor%20access%20request"`);
    expect(html).not.toContain("sign-up=1");
    expect(html).toContain('href="https://github.com/x/y"');
    expect(html).toContain("https://makor.example/api/v1/extract");
    expect(html).toContain("5 documents free");
    expect(html).toContain("Documents in,\nJSON out");
    expect(html).toContain("/fishart.png");
    expect(html).toContain("license_number");
    expect(html).toContain("micr_line");
    expect(html).toContain("&quot;overall&quot;: &quot;verified&quot;");
  });
  it("states the registries check and search, with what the check looks up and the disclaimer", () => {
    for (const [m, locale] of [[en.landing, "en"], [he.landing, "he"]] as const) {
      const html = render(m, locale);
      for (const s of m.registries.sources) expect(html).toContain(s.name);
      expect(html).toContain(m.registries.note.replaceAll('"', "&quot;"));
      for (const f of ["check_registries=true", ...CHECK_FIELDS, "GET /api/v1/registries/search"]) expect(html).toContain(`>${f}</li>`);
    }
    expect(render(en.landing, "en")).toContain("&quot;registries&quot;: {");
  });

  it("prefixes hrefs for Hebrew and keeps the curl block LTR", () => {
    const html = render(he.landing, "he");
    expect(html).not.toContain("sign-up=1");
    expect(html).toContain('href="/he?sign-in=1"');
    expect(html).toContain('href="/he/api-reference"');
    expect(html).toMatch(/<pre[^>]*dir="ltr"/);
    expect(html).toMatch(/role="img"[^>]*dir="ltr"/);
    expect(html).toContain("5 מסמכים");
    expect(html).not.toContain("zinc-");
  });

  it("renders the three snippet tabs, the hero facts and the privacy law line", () => {
    const html = render(en.landing, "en");
    for (const tab of ["curl", "Python", "TypeScript"]) expect(html).toContain(tab);
    for (const f of en.landing.hero.facts) expect(html).toContain(f);
    expect(html).toContain(en.landing.privacy.law);
    expect(html).toContain("123456782"); // the hero demo's synthetic ID
    expect((html.match(/data-step="/g) ?? []).length).toBe(4);
    expect(html).toContain("check digit");
  });

  it("paints the primary CTAs (hero + cloud way) in the highlight colour and the API tabs as line tabs", () => {
    const html = render(en.landing, "en");
    expect((html.match(/data-variant="highlight"/g) ?? []).length).toBe(2);
    expect(html).toMatch(/<a [^>]*href="mailto:[^"]*subject=Makor%20access%20request"[^>]*data-variant="highlight"/);
    expect(html).toContain('data-slot="line-tab-indicator"');
  });
});
