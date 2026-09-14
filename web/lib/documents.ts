import { and, count, desc, eq, gt, gte, inArray, isNotNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { documents, type DocumentRow } from "@/lib/db/schema";
import { DOC_FAMILIES, docFamily, familyTypes, type DocFamily } from "@/lib/doc-types";
import { parseSummary, type RegistriesSummary } from "@/lib/registries/check";

export function newDocumentId(): string {
  return randomUUID();
}

export const PENDING_STATUS = 102;

type StartRow = Omit<DocumentRow, "status"> & { status?: number };

/** Accounting must never cost the caller the response: failures are logged (ids only). */
export function recordDocument(db: Db, row: DocumentRow): void {
  try {
    db.insert(documents).values(row).run();
  } catch (err) {
    console.error(`documents insert failed user=${row.userId} status=${row.status}: ${(err as Error).message}`);
  }
}

/** Inserts the pending row for a request that is about to reach the engine. */
export function startDocument(db: Db, row: StartRow): void {
  try {
    db.insert(documents).values({ status: PENDING_STATUS, ...row }).run();
  } catch (err) {
    console.error(`documents start failed id=${row.id} user=${row.userId}: ${(err as Error).message}`);
  }
}

/** Updates a row started by startDocument/reserveTrial with the outcome. */
export function finishDocument(db: Db, id: string, patch: Partial<DocumentRow>): void {
  try {
    db.update(documents).set(patch).where(eq(documents.id, id)).run();
  } catch (err) {
    console.error(`documents finish failed id=${id} status=${patch.status}: ${(err as Error).message}`);
  }
}

/** Counts successful trial documents plus still-fresh pending reservations (mode=trial only). */
export function trialUsed(db: Db, userId: string, now: Date = new Date(), pendingWindowMs: number): number {
  const since = new Date(now.getTime() - pendingWindowMs).toISOString();
  const row = db.select({ n: count() }).from(documents).where(and(
    eq(documents.userId, userId),
    eq(documents.mode, "trial"),
    or(eq(documents.status, 200), and(eq(documents.status, PENDING_STATUS), gt(documents.createdAt, since))),
  )).get();
  return row?.n ?? 0;
}

/** A pending row must outlive the longest possible request: the engine timeout plus slack. */
export function pendingWindowMs(engineTimeoutMs: number): number {
  return engineTimeoutMs + 60_000;
}

/** Count + insert under one write lock so parallel trial requests cannot all pass. */
export function reserveTrial(db: Db, userId: string, trialDocs: number, row: StartRow, now: Date = new Date(), windowMs: number): boolean {
  return db.transaction((tx) => {
    if (trialUsed(tx as unknown as Db, userId, now, windowMs) >= trialDocs) return false;
    tx.insert(documents).values({ status: PENDING_STATUS, ...row }).run();
    return true;
  }, { behavior: "immediate" });
}

/** Rows a crashed process left at 102: close them so the dashboard stops showing "pending". */
export function sweepStalePending(db: Db, windowMs: number, now: Date = new Date()): number {
  const since = new Date(now.getTime() - windowMs).toISOString();
  return db.update(documents).set({ status: 500, errorCode: "INTERRUPTED" })
    .where(and(eq(documents.status, PENDING_STATUS), lt(documents.createdAt, since))).run().changes;
}

export interface DocumentMeta {
  id: string;
  createdAt: string;
  status: number;
  docType: string | null;
  verdict: string | null;
  sefach: boolean;
  mode: string;
  source: string;
  backend: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  latencyMs: number;
  costUsd: number | null;
  errorCode: string | null;
  hasResult: boolean;
  registries: RegistriesSummary | null;
}

export interface UsageSummary {
  month: string;
  docsThisMonth: number;
  okThisMonth: number;
  failedThisMonth: number;
  total: number;
  trialUsed: number;
}

export interface DashboardStats {
  total: number;
  last30Days: number;
  medianLatencyMs: number | null;
  /** Sums over successful rows that carry a price; null when none does (an all-Ollama history). */
  costUsd: { last30Days: number | null; total: number | null };
  byType: { key: string; n: number }[];
  byVerdict: { key: string; n: number }[];
}

const META_COLUMNS = {
  id: documents.id, createdAt: documents.createdAt, status: documents.status, docType: documents.docType, verdict: documents.verdict,
  sefach: documents.sefach, mode: documents.mode, source: documents.source, backend: documents.backend, model: documents.model,
  tokensIn: documents.tokensIn, tokensOut: documents.tokensOut, tokensCached: documents.tokensCached, latencyMs: documents.latencyMs, costUsd: documents.costUsd,
  errorCode: documents.errorCode, hasResult: sql<number>`${documents.resultEnc} is not null`, registries: documents.registries,
};

/** The documents list's filters: every key optional; `family` is a `doc-types` family (every region
 * type of it matches), `from`/`to` are calendar days (YYYY-MM-DD, UTC, inclusive). */
export interface DocumentFilters {
  family?: string;
  verdict?: string;
  status?: "ok" | "pending" | "failed";
  backend?: string;
  source?: string;
  from?: string;
  to?: string;
}

function filterClauses(f: DocumentFilters): SQL[] {
  const c: SQL[] = [];
  if (f.family) { const types = familyTypes(f.family); c.push(types.length ? inArray(documents.docType, types) : sql`0`); }
  if (f.verdict) c.push(eq(documents.verdict, f.verdict));
  if (f.status === "ok") c.push(eq(documents.status, 200));
  else if (f.status === "pending") c.push(eq(documents.status, PENDING_STATUS));
  else if (f.status === "failed") c.push(and(ne(documents.status, 200), ne(documents.status, PENDING_STATUS))!);
  if (f.backend) c.push(eq(documents.backend, f.backend));
  if (f.source) c.push(eq(documents.source, f.source));
  if (f.from) c.push(gte(documents.createdAt, `${f.from}T00:00:00.000Z`));
  if (f.to) c.push(lte(documents.createdAt, `${f.to}T23:59:59.999Z`));
  return c;
}

/** Newest first, scoped to the caller's own documents (and the filters, if any); never returns result_enc. */
export function listDocuments(db: Db, userId: string, opts: { limit?: number; offset?: number; filters?: DocumentFilters } = {}): { items: DocumentMeta[]; total: number } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = and(eq(documents.userId, userId), ...filterClauses(opts.filters ?? {}));
  const rows = db.select(META_COLUMNS).from(documents).where(where)
    .orderBy(desc(documents.createdAt), desc(documents.id)).limit(limit).offset(offset).all();
  const total = db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;
  return { items: rows.map((r) => ({ ...r, hasResult: Boolean(r.hasResult), registries: parseSummary(r.registries) })), total };
}

export interface DocumentFacets { families: DocFamily[]; verdicts: string[]; backends: string[]; sources: string[] }

/** The distinct values the list's filter selects offer: only what the user's own rows carry —
 * families in display order, the rest sorted. */
export function documentFacets(db: Db, userId: string): DocumentFacets {
  const distinct = (col: AnySQLiteColumn) => db.selectDistinct({ v: col }).from(documents)
    .where(and(eq(documents.userId, userId), isNotNull(col))).orderBy(col).all().map((r) => String(r.v));
  const present = new Set(distinct(documents.docType).map(docFamily));
  return { families: DOC_FAMILIES.filter((f) => present.has(f)), verdicts: distinct(documents.verdict), backends: distinct(documents.backend), sources: distinct(documents.source) };
}

export function getDocumentResult(db: Db, userId: string, id: string): { found: boolean; resultEnc: string | null } {
  const row = db.select({ resultEnc: documents.resultEnc }).from(documents).where(and(eq(documents.id, id), eq(documents.userId, userId))).get();
  return row ? { found: true, resultEnc: row.resultEnc } : { found: false, resultEnc: null };
}

/** Nulls result_enc; returns false when the id does not belong to userId (not found or someone else's). */
export function deleteDocumentResult(db: Db, userId: string, id: string): boolean {
  return db.update(documents).set({ resultEnc: null }).where(and(eq(documents.id, id), eq(documents.userId, userId))).run().changes > 0;
}

/** Clears result_enc for every row of userId that still had one; returns the number of rows changed. */
export function deleteAllResults(db: Db, userId: string): number {
  return db.update(documents).set({ resultEnc: null }).where(and(eq(documents.userId, userId), isNotNull(documents.resultEnc))).run().changes;
}

export function usageSummary(db: Db, userId: string, windowMs: number, now: Date = new Date()): UsageSummary {
  const month = now.toISOString().slice(0, 7);
  const monthStart = `${month}-01T00:00:00.000Z`;
  const inMonth = and(eq(documents.userId, userId), gte(documents.createdAt, monthStart));
  const n = (where: ReturnType<typeof and>) => db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;
  const docsThisMonth = n(inMonth);
  const okThisMonth = n(and(inMonth, eq(documents.status, 200)));
  return {
    month, docsThisMonth, okThisMonth, failedThisMonth: docsThisMonth - okThisMonth,
    total: n(eq(documents.userId, userId)), trialUsed: trialUsed(db, userId, now, windowMs),
  };
}

/** Dashboard aggregates: type/verdict breakdown and median latency use successful (status=200) rows only. */
export function dashboardStats(db: Db, userId: string, now: Date = new Date()): DashboardStats {
  const ok = and(eq(documents.userId, userId), eq(documents.status, 200));
  const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const group = (col: typeof documents.docType | typeof documents.verdict) => db.select({ key: col, n: count() }).from(documents).where(and(ok, isNotNull(col)))
    .groupBy(col).orderBy(desc(count()), col).all().map((r) => ({ key: String(r.key), n: r.n }));
  /* Region types folded into document families, largest first, ties by key. */
  const byFamily = () => {
    const n = new Map<string, number>();
    for (const r of group(documents.docType)) { const f = docFamily(r.key) ?? r.key; n.set(f, (n.get(f) ?? 0) + r.n); }
    return [...n].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  };
  const latencies = db.select({ l: documents.latencyMs }).from(documents).where(ok).orderBy(documents.latencyMs).all().map((r) => r.l);
  const median = latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : null;
  const priced = and(ok, isNotNull(documents.costUsd));
  const cost = (where: ReturnType<typeof and>) => db.select({ s: sql<number | null>`sum(${documents.costUsd})` }).from(documents).where(where).get()?.s ?? null;
  return {
    costUsd: { last30Days: cost(and(priced, gte(documents.createdAt, since30))), total: cost(priced) },
    total: db.select({ n: count() }).from(documents).where(eq(documents.userId, userId)).get()?.n ?? 0,
    last30Days: db.select({ n: count() }).from(documents).where(and(eq(documents.userId, userId), gte(documents.createdAt, since30))).get()?.n ?? 0,
    medianLatencyMs: median, byType: byFamily(), byVerdict: group(documents.verdict),
  };
}
