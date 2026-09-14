import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";
import { INDEXED_PATHS, languageAlternates, localeHref, pageMetadata } from "@/lib/seo";
import en from "@/messages/en.json";
import he from "@/messages/he.json";

function stubClerk() {
  vi.stubEnv("AUTH_MODE", "clerk");
  vi.stubEnv("MAKOR_MASTER_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubEnv("ENGINE_SECRET", "s");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_y");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test/");
}

afterEach(() => vi.unstubAllEnvs());

describe("locale URLs", () => {
  it("prefixes only the non-default locale, and its home has no trailing slash", () => {
    expect(localeHref("en", "/")).toBe("/");
    expect(localeHref("he", "/")).toBe("/he");
    expect(localeHref("en", "/privacy")).toBe("/privacy");
    expect(localeHref("he", "/privacy")).toBe("/he/privacy");
  });

  it("gives every locale plus x-default = the default locale", () => {
    expect(languageAlternates("/terms")).toEqual({ en: "/terms", he: "/he/terms", "x-default": "/terms" });
  });
});

describe("pageMetadata", () => {
  const base = { locale: "he", title: "T", description: "D", ogAlt: "A" };

  it("sets canonical, hreflang, og and twitter for the locale", () => {
    const m = pageMetadata({ ...base, path: "/privacy" });
    expect(m.title).toBe("T");
    expect(m.alternates?.canonical).toBe("/he/privacy");
    expect(m.alternates?.languages).toEqual(languageAlternates("/privacy"));
    expect(m.openGraph).toMatchObject({ url: "/he/privacy", locale: "he_IL", alternateLocale: ["en_US"], title: "T · Makor" });
    expect(m.openGraph?.images).toEqual([{ url: "/og/makor-he.png", width: 1200, height: 630, alt: "A" }]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "T · Makor" });
  });

  it("an absolute title skips the template and the brand suffix", () => {
    const m = pageMetadata({ ...base, path: "/", absoluteTitle: true });
    expect(m.title).toEqual({ absolute: "T" });
    expect(m.openGraph).toMatchObject({ title: "T" });
  });

  it("a duplicate page points its canonical at the original", () => {
    const m = pageMetadata({ ...base, locale: "en", path: "/about", canonicalPath: "/" });
    expect(m.alternates?.canonical).toBe("/");
    expect(m.openGraph).toMatchObject({ url: "/" });
  });
});

describe("robots.txt", () => {
  it("clerk mode: allows the public site, keeps the app and the API out, names the sitemap", () => {
    stubClerk();
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toContain("/app");
    expect(rules.disallow).toContain("/he/app");
    // The API rule must not also match /api-reference.
    expect(rules.disallow).toContain("/api/");
    expect(rules.disallow).not.toContain("/api");
    expect(r.sitemap).toBe("https://example.test/sitemap.xml");
  });

  it("none mode: a local instance disallows everything", () => {
    vi.stubEnv("AUTH_MODE", "none");
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.disallow).toBe("/");
    expect(r.sitemap).toBeUndefined();
  });
});

describe("sitemap.xml", () => {
  it("lists every indexed path in every locale with absolute hreflang alternates", () => {
    stubClerk();
    const s = sitemap();
    expect(s).toHaveLength(INDEXED_PATHS.length * 2);
    const hePrivacy = s.find((e) => e.url === "https://example.test/he/privacy");
    expect(hePrivacy?.lastModified).toBeTruthy();
    expect(hePrivacy?.alternates?.languages).toEqual({
      en: "https://example.test/privacy", he: "https://example.test/he/privacy", "x-default": "https://example.test/privacy",
    });
    expect(s.map((e) => e.url)).not.toContain("https://example.test/about");
  });
});

describe("manifest and messages", () => {
  it("the manifest's icons are the files scripts/brand-icons.mjs writes", () => {
    expect(manifest().icons?.map((i) => i.src)).toEqual(["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]);
  });

  it("descriptions stay within what a results page shows", () => {
    for (const m of [en.meta, he.meta]) {
      for (const d of [m.description, m.apiReference.description, m.privacy.description, m.terms.description]) expect(d.length).toBeLessThanOrEqual(160);
      expect(m.title.length).toBeLessThanOrEqual(60);
    }
  });
});
