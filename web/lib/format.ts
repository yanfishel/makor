/** "11 Sep 2026, 20:07" — 24-hour clock, no zone suffix; the caller says which zone (UTC on the server, the browser's on the client). */
export function formatStamp(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
}
export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}
/** The documents table's "Engine" cell: `mode` is the billing mode (local / byok / trial — always
 * `local` without accounts), so the backend that actually ran the document is shown beside it. */
export function engineLabel(backend: string | null): string {
  return backend ?? "\u2014";
}

/** A latency, written the way the extract page writes its own readings: no gap before the
 * unit, so a narrow table cell cannot wrap the number away from it. */
export function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
export function statusLabel(row: { status: number; errorCode: string | null }): "ok" | "pending" | "failed" {
  if (row.status === 200) return "ok";
  if (row.status === 102) return "pending";
  return "failed";
}

/** USD to the tenth of a cent: a single cheque costs a few cents. Null = the document was not
 * priced (Ollama, or a model missing from the price table), never shown as $0. */
export function formatCost(usd: number | null, digits: 2 | 3 = 3): string {
  if (usd == null) return "\u2014";
  const floor = digits === 3 ? 0.001 : 0.01;
  if (usd > 0 && usd < floor / 2) return `<$${floor.toFixed(digits)}`;
  return `$${usd.toFixed(digits)}`;
}
/** The documents table's token cell: input / output. */
export function formatTokens(tokensIn: number, tokensOut: number, locale: string): string {
  const n = new Intl.NumberFormat(locale);
  return `${n.format(tokensIn)} / ${n.format(tokensOut)}`;
}

/** A reading that IS a date, as the documents themselves print it: "2023-02-19" → "19.02.2023".
 * Only an exact ISO date is rewritten — a field's value is free text and an ID number, an MRZ
 * line or a street must pass through untouched — and the disability card's month-precision
 * expiry ("2014-03") keeps its precision as "03.2014" rather than inventing a day. Null when
 * the value is not a date, so the caller can print it as it came. */
export function formatFieldDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [, year, month, day] = m;
  if (Number(month) < 1 || Number(month) > 12 || (day && (Number(day) < 1 || Number(day) > 31))) return null;
  return day ? `${day}.${month}.${year}` : `${month}.${year}`;
}

/** A file's size for the scene toolbar: whole kilobytes under a megabyte, one decimal above —
 * "0.0 MB" would say nothing about a 40 KB scan. */
export function formatFileSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
