import { describe, expect, it } from "vitest";
import { PRICES_DATE } from "@/lib/pricing";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "@/messages/en.json";
import he from "@/messages/he.json";
import { ApiDocs } from "@/components/ApiDocs";
import { ENDPOINTS, ERROR_CODES, EXAMPLE_RESPONSE, snippets } from "@/lib/api-reference";

describe("api reference", () => {
  it("lists the image requirements as short bullets: one document per page, what is not guaranteed", () => {
    const html = renderToStaticMarkup(createElement(ApiDocs, { m: en.docs, siteUrl: "https://makor.example" }));
    expect(en.docs.image.items.length).toBeGreaterThanOrEqual(5);
    for (const item of en.docs.image.items) expect(item.length).toBeLessThan(220);
    expect(html).toContain("not guaranteed");
    expect(html).toContain("One document per");
    expect(html.match(/<li/g)!.length).toBeGreaterThanOrEqual(en.docs.image.items.length);
  });
  it("offers each example — extraction, registries search, settings — as curl / Python / TypeScript tabs, curl first", () => {
    const html = renderToStaticMarkup(createElement(ApiDocs, { m: en.docs, siteUrl: "https://makor.example" }));
    const examples = html.slice(html.indexOf('id="snippets"'));
    const tabs = [...examples.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((x) => x[1]);
    expect(tabs).toEqual(["curl", "Python", "TypeScript", "curl", "Python", "TypeScript", "curl", "Python", "TypeScript"]);
    expect(examples.match(/role="tab"[^>]*aria-selected="true"[^>]*>curl</g)).toHaveLength(3);
    for (const title of Object.values(en.docs.snippetTitles)) expect(examples).toContain(title);
  });
  it("groups the endpoints into extraction, registries search and settings, each with its own table, in that order", () => {
    const html = renderToStaticMarkup(createElement(ApiDocs, { m: en.docs, siteUrl: "https://makor.example" }));
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at("endpoints-extraction")).toBeGreaterThan(at("endpoints"));
    expect(at("endpoints-search")).toBeGreaterThan(at("endpoints-extraction"));
    expect(at("endpoints-settings")).toBeGreaterThan(at("endpoints-search"));
    expect(at("limits")).toBeGreaterThan(at("endpoints-settings"));
    for (const e of ENDPOINTS) {
      const pos = html.indexOf(`>${e.path.replace(/&/g, "&amp;")}<`);
      const next = { extraction: "endpoints-search", search: "endpoints-settings", settings: "limits" }[e.group];
      expect(pos).toBeGreaterThan(at(`endpoints-${e.group}`));
      expect(pos).toBeLessThan(at(next));
    }
  });
  it("states the limits: the request budgets with 429 and Retry-After, uploads, waiting, trial, search rows, storage", () => {
    const html = renderToStaticMarkup(createElement(ApiDocs, { m: en.docs, siteUrl: "https://makor.example" }));
    const limits = html.slice(html.indexOf('id="limits"'), html.indexOf('id="response"'));
    for (const needle of ["30 requests a minute", "20 a minute", "RATE_LIMITED", "Retry-After", "30 MB", "50 rows", "store_results"]) expect(limits).toContain(needle);
    expect(he.docs.limits.items).toHaveLength(en.docs.limits.items.length);
  });
  it("lists the response shape as bullets that name the verdicts and the document types", () => {
    const html = renderToStaticMarkup(createElement(ApiDocs, { m: en.docs, siteUrl: "https://makor.example" }));
    expect(en.docs.responseItems.length).toBeGreaterThanOrEqual(5);
    for (const item of en.docs.responseItems) expect(item.length).toBeLessThan(260);
    expect(html).toContain("verified / partial / unverified / mismatch");
    expect(html).toContain("not_a_document");
    expect(html.match(/<li/g)!.length).toBeGreaterThanOrEqual(en.docs.image.items.length + en.docs.responseItems.length);
  });
  it("snippets point at the site, every language sends the bearer header, and each example calls its endpoint", () => {
    const s = snippets("https://makor.example");
    const calls = { extract: ["https://makor.example/api/v1/extract", "check_registries"], search: ["https://makor.example/api/v1/registries/search?id=510000003"], settings: ["https://makor.example/api/v1/settings", "PATCH", "check_registries"] } as const;
    for (const [example, needles] of Object.entries(calls)) {
      for (const code of Object.values(s[example as keyof typeof s])) {
        expect(code).toContain("Bearer ak_");
        for (const needle of needles) expect(code.toLowerCase()).toContain(needle.toLowerCase());
      }
    }
  });
  it("every endpoint and error code has a description in both languages", () => {
    for (const e of ENDPOINTS) { expect(en.docs.endpoints).toHaveProperty(e.key); expect(he.docs.endpoints).toHaveProperty(e.key); }
    for (const e of ERROR_CODES) { expect(en.docs.errors).toHaveProperty(e.key); expect(he.docs.errors).toHaveProperty(e.key); }
  });
  it("renders the tables, the example and LTR code blocks", () => {
    const html = renderToStaticMarkup(createElement(ApiDocs, { m: he.docs, siteUrl: "https://makor.example" }));
    for (const e of ENDPOINTS) expect(html).toContain(e.path.replace(/&/g, "&amp;"));
    for (const e of ERROR_CODES) expect(html).toContain(e.code);
    expect(html).toContain("123456782");
    expect((html.match(/<pre[^>]*dir="ltr"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(EXAMPLE_RESPONSE).validation.overall).toBe("unverified");
    expect(html).toContain(PRICES_DATE);  // the cost footnote names the price list's date   // a card front has no MRZ — unverified by design (CLAUDE.md domain rules)
  });
});
