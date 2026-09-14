export const GITHUB_URL = "https://github.com/yanfishel/makor";

/** The landing's sections in page order, by their element ids: the mobile menu links to each. */
export const LANDING_SECTIONS = ["how", "reads", "registries", "privacy", "ways", "api"] as const;
export type LandingSection = (typeof LANDING_SECTIONS)[number];

export const CONTACT_EMAIL = "yan.fishel@gmail.com";

/** The subject of the "Request access" mailto — registering is by invitation, this is how to ask for one. */
export const REQUEST_ACCESS_SUBJECT = "Makor access request";

/** A `mailto:` with the subject pre-filled, so feedback arrives sorted. */
export function mailtoHref(subject: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/** Prefixes a path for the non-default locale, matching next-intl's "as-needed" prefix. */
export function localePath(locale: string, path: string): string {
  return locale === "en" ? path : `/${locale}${path}`;
}

/** Landing URL that opens Clerk's sign-in modal (`AuthModalOpener`); there are no auth pages and no open registration. */
export function authHref(locale: string, mode: "sign-in"): string {
  return `${locale === "en" ? "" : `/${locale}`}/?${mode}=1`.replace(/^\/([a-z]{2})\/\?/, "/$1?");
}
