/** Shared page arithmetic for the dashboard and admin tables: 1-based pages, out-of-range values clamped. */
export const PAGE_SIZE = 20;

export function parsePage(raw: string | string[] | undefined | null): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw ?? 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The page actually shown: never past the last one, so a stale link after deletions still renders rows. */
export function clampPage(page: number, total: number, pageSize: number = PAGE_SIZE): number {
  return Math.min(page, pageCount(total, pageSize));
}
