/** Israeli bank codes (public, Bank of Israel) for the search form and the results; an unlisted code shows as the bare number. */
export const BANKS: Readonly<Record<number, { he: string; en: string }>> = {
  4: { he: "בנק יהב", en: "Bank Yahav" },
  9: { he: "בנק הדואר", en: "Postal Bank" },
  10: { he: "בנק לאומי", en: "Bank Leumi" },
  11: { he: "בנק דיסקונט", en: "Discount Bank" },
  12: { he: "בנק הפועלים", en: "Bank Hapoalim" },
  13: { he: "בנק אגוד", en: "Union Bank" },
  14: { he: "בנק אוצר החייל", en: "Bank Otsar Ha-Hayal" },
  17: { he: "בנק מרכנתיל דיסקונט", en: "Mercantile Discount Bank" },
  18: { he: "וואן זירו", en: "One Zero Digital Bank" },
  20: { he: "בנק מזרחי טפחות", en: "Mizrahi Tefahot Bank" },
  22: { he: "סיטיבנק", en: "Citibank" },
  23: { he: "HSBC", en: "HSBC" },
  26: { he: "יובנק", en: "UBank" },
  31: { he: "הבנק הבינלאומי הראשון", en: "First International Bank" },
  34: { he: "בנק ערבי ישראלי", en: "Arab Israel Bank" },
  46: { he: "בנק מסד", en: "Bank Massad" },
  52: { he: "בנק פועלי אגודת ישראל", en: "Poalei Agudat Israel Bank" },
  54: { he: "בנק ירושלים", en: "Bank of Jerusalem" },
};

export const BANK_CODES: readonly number[] = Object.keys(BANKS).map(Number).sort((a, b) => a - b);

export function bankLabel(code: number, locale: string): string {
  const bank = BANKS[code];
  return bank ? `${code} · ${locale === "he" ? bank.he : bank.en}` : String(code);
}
