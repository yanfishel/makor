/** The date the Terms of Use and the Privacy Policy last changed — bump it with any edit to `legal.*` in the messages. */
export const LEGAL_DATE = "2026-09-13";

/** The legal date as a reader's calendar day ("September 13, 2026" / "13 בספטמבר 2026"); UTC so the day never shifts. */
export function formatLegalDate(locale: string, iso: string = LEGAL_DATE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}
