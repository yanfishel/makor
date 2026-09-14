import type { DocumentFilters } from "@/lib/documents";

/** The list page's URL contract: query name ↔ filter key; `page` is appended last by filtersHref. */
export const DOCUMENTS_PATH = "/app/documents";
export const STATUS_FILTERS = ["ok", "pending", "failed"] as const;
export const FILTER_PARAMS: { param: string; key: keyof DocumentFilters }[] = [
  { param: "type", key: "family" }, { param: "verdict", key: "verdict" }, { param: "status", key: "status" },
  { param: "engine", key: "backend" }, { param: "source", key: "source" }, { param: "from", key: "from" }, { param: "to", key: "to" },
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Query = Record<string, string | string[] | undefined>;

/** Reads the filters off the search params: empty and malformed values are dropped, never passed to the query. */
export function parseFilters(query: Query): DocumentFilters {
  const out: DocumentFilters = {};
  for (const { param, key } of FILTER_PARAMS) {
    const raw = query[param];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (!v) continue;
    if (key === "status") { if ((STATUS_FILTERS as readonly string[]).includes(v)) out.status = v as DocumentFilters["status"]; continue; }
    if (key === "from" || key === "to") { if (DAY.test(v)) out[key] = v; continue; }
    out[key] = v;
  }
  return out;
}

/** The list URL for a filter set and page; page 1 and empty filters leave the bare path. */
export function filtersHref(filters: DocumentFilters, page: number = 1): string {
  const q = new URLSearchParams();
  for (const { param, key } of FILTER_PARAMS) if (filters[key]) q.set(param, filters[key]!);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `${DOCUMENTS_PATH}?${s}` : DOCUMENTS_PATH;
}
