/** Digits only: "1 2345678 2", "0123456782" and "123456782" compare equal as numbers.
 * Null when no digit is left, or when the number would exceed exact integer range. */
export function digitsValue(raw: string | null | undefined): number | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/** Hebrew points and cantillation (the letters start at U+05D0; maqaf U+05BE is handled
 * apart), Arabic harakat, superscript alef and tatweel. */
const MARKS = /[\u0591-\u05BD\u05BF-\u05C7\u064B-\u065F\u0670\u0640]/g;
/** Geresh, gershayim, ASCII quotes, backtick, and the `~` the companies data writes for a quote. */
const QUOTES = /[\u05F3\u05F4'"`~]/g;

/** One normalisation for indexing and for querying, so both sides always agree. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFC")
    .replace(/[\u05BE\u2010-\u2015-]/g, " ")
    .replace(MARKS, "")
    .replace(QUOTES, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function iso(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1800 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

export function isoFromYyyymmdd(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s.trim());
  return m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** The Bank of Israel header date; the files are current, so the century is 2000. */
export function isoFromYymmdd(s: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s.trim());
  return m ? iso(2000 + Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

export function isoFromDmy(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? iso(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
export function isoFromExcelSerial(n: number): string | null {
  return Number.isFinite(n) && n > 0 ? new Date(EXCEL_EPOCH_MS + Math.floor(n) * 86_400_000).toISOString().slice(0, 10) : null;
}

/** An xlsx date cell: a serial ("46275", possibly with a fraction) or DD/MM/YYYY text. */
export function isoFromCell(v: string): string | null {
  const s = v.trim();
  return /^\d{5}(?:\.\d+)?$/.test(s) ? isoFromExcelSerial(Number(s)) : isoFromDmy(s);
}
