import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/links";

export const SITE_NAME = "Makor";

const OG_LOCALE: Record<string, string> = { en: "en_US", he: "he_IL" };

/** The public pages a search engine may index, in sitemap order. `/about` is left out: it renders the landing, whose canonical is `/`. */
export const INDEXED_PATHS = ["/", "/api-reference", "/privacy", "/terms"] as const;

/** A page's path in a locale: `localePath`, except that the non-default locale's home is `/he`, never `/he/`. */
export function localeHref(locale: string, path: string): string {
  return path === "/" && locale !== routing.defaultLocale ? `/${locale}` : localePath(locale, path);
}

/** Every locale's URL of a path, plus `x-default` (the default locale) — the hreflang set. */
export function languageAlternates(path: string): Record<string, string> {
  const entries = routing.locales.map((l) => [l, localeHref(l, path)]);
  return { ...Object.fromEntries(entries), "x-default": localeHref(routing.defaultLocale, path) };
}

/** The link-preview image: the landing's hero rendered at 1200 × 630 in that locale (`e2e/og-images.ts`). */
export function ogImage(locale: string, alt: string) {
  return { url: `/og/makor-${locale}.png`, width: 1200, height: 630, alt };
}

/**
 * Metadata for an indexable public page. Next merges metadata one top-level key at a time, so
 * `openGraph` and `twitter` are always given whole here — a page that set only a title would
 * otherwise keep the parent's og:url and og:title.
 */
export function pageMetadata(opts: {
  locale: string;
  /** The route without its locale prefix, e.g. `/privacy`. */
  path: string;
  title: string;
  description: string;
  ogAlt: string;
  /** The landing's title is the full brand line, so it skips the `%s · Makor` template. */
  absoluteTitle?: boolean;
  /** A page that duplicates another names that one as canonical. */
  canonicalPath?: string;
}): Metadata {
  const { locale, path, title, description, ogAlt } = opts;
  const canonicalPath = opts.canonicalPath ?? path;
  const url = localeHref(locale, canonicalPath);
  const image = ogImage(locale, ogAlt);
  // A link preview has no template, so it carries the brand itself.
  const shareTitle = opts.absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  return {
    title: opts.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url, languages: languageAlternates(canonicalPath) },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: shareTitle,
      description,
      url,
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images: [image],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [image] },
  };
}

/** Pages that exist only for a signed-in session or an invitation link: never in a search index. */
export const NOINDEX: Metadata = { robots: { index: false, follow: false } };
