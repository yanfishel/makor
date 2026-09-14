import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getConfig } from "@/lib/config";
import { LEGAL_DATE } from "@/lib/legal";
import { INDEXED_PATHS, languageAlternates, localeHref } from "@/lib/seo";

// Per request, like robots.ts: the absolute URLs come from NEXT_PUBLIC_SITE_URL at run time.
export const dynamic = "force-dynamic";

/** Every indexed public page in every locale, each entry carrying its hreflang set. */
export default function sitemap(): MetadataRoute.Sitemap {
  const { siteUrl } = getConfig();
  const abs = (href: string) => `${siteUrl}${href}`;
  return INDEXED_PATHS.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: abs(localeHref(locale, path)),
      // Only the legal pages have a date the code knows; the rest omit it rather than invent one.
      ...(path === "/privacy" || path === "/terms" ? { lastModified: LEGAL_DATE } : {}),
      alternates: { languages: Object.fromEntries(Object.entries(languageAlternates(path)).map(([l, h]) => [l, abs(h)])) },
    })),
  );
}
