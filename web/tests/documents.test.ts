import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import {
  dashboardStats,
  documentFacets,
  deleteAllResults,
  deleteDocumentResult,
  finishDocument,
  getDocumentResult,
  listDocuments,
  newDocumentId,
  pendingWindowMs,
  recordDocument,
  reserveTrial,
  startDocument,
  sweepStalePending,
  trialUsed,
  usageSummary,
  PENDING_STATUS,
} from "@/lib/documents";

const db = () => openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-docs-")), "t.sqlite3"));
const base = { userId: "u1", createdAt: "2026-09-06T00:00:00Z", source: "ui" as const };
const WINDOW_MS = 10 * 60 * 1000;

describe("trialUsed", () => {
  it("counts only successful trial documents of that user", () => {
    const d = db();
    recordDocument(d, { ...base, id: newDocumentId(), status: 200, mode: "trial" });
    recordDocument(d, { ...base, id: newDocumentId(), status: 502, mode: "trial" });
    recordDocument(d, { ...base, id: newDocumentId(), status: 200, mode: "byok" });
    recordDocument(d, { ...base, id: newDocumentId(), status: 200, mode: "trial", userId: "u2" });
    expect(trialUsed(d, "u1", new Date(), WINDOW_MS)).toBe(1);
    expect(trialUsed(d, "nobody", new Date(), WINDOW_MS)).toBe(0);
  });
});

describe("recordDocument", () => {
  it("never throws on a bad row", () => {
    const d = db();
    // @ts-expect-error deliberately missing NOT NULL columns
    expect(() => recordDocument(d, { id: "x" })).not.toThrow();
  });
});

describe("start/finish and trial reservation", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  it("pending rows count toward the trial while fresh, not when stale", () => {
    const d = db();
    startDocument(d, { ...base, id: "p1", mode: "trial", createdAt: now.toISOString() });
    expect(trialUsed(d, "u1", now, WINDOW_MS)).toBe(1);
    const stale = new Date(now.getTime() + 11 * 60 * 1000);
    expect(trialUsed(d, "u1", stale, WINDOW_MS)).toBe(0);
    finishDocument(d, "p1", { status: 200 });
    expect(trialUsed(d, "u1", stale, WINDOW_MS)).toBe(1);
  });
  it("reserveTrial admits exactly trialDocs concurrent requests", () => {
    const d = db();
    const row = (id: string) => ({ ...base, id, mode: "trial", createdAt: now.toISOString() });
    expect(reserveTrial(d, "u1", 2, row("a"), now, WINDOW_MS)).toBe(true);
    expect(reserveTrial(d, "u1", 2, row("b"), now, WINDOW_MS)).toBe(true);
    expect(reserveTrial(d, "u1", 2, row("c"), now, WINDOW_MS)).toBe(false);
    expect(d.select().from(documents).all().map((r) => r.status)).toEqual([PENDING_STATUS, PENDING_STATUS]);
  });
  it("a failed request releases its reservation", () => {
    const d = db();
    reserveTrial(d, "u1", 1, { ...base, id: "a", mode: "trial", createdAt: now.toISOString() }, now, WINDOW_MS);
    finishDocument(d, "a", { status: 502, errorCode: "ENGINE_ERROR" });
    expect(reserveTrial(d, "u1", 1, { ...base, id: "b", mode: "trial", createdAt: now.toISOString() }, now, WINDOW_MS)).toBe(true);
  });
});

describe("queries", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
  function seeded() {
    const d = db();
    recordDocument(d, { ...base, id: "a", status: 200, mode: "local", createdAt: at(1), docType: "teudat_zehut", verdict: "verified", latencyMs: 100, resultEnc: "v1:x:y:z" });
    recordDocument(d, { ...base, id: "b", status: 200, mode: "local", createdAt: at(2), docType: "cheque", verdict: "mismatch", latencyMs: 300 });
    recordDocument(d, { ...base, id: "c", status: 502, mode: "local", createdAt: at(3), errorCode: "ENGINE_ERROR", latencyMs: 50 });
    recordDocument(d, { ...base, id: "d", status: 200, mode: "local", createdAt: at(40), docType: "teudat_zehut", verdict: "unverified", latencyMs: 200 });
    recordDocument(d, { ...base, id: "z", status: 200, mode: "local", createdAt: at(1), userId: "u2", docType: "cheque", verdict: "verified" });
    return d;
  }
  it("lists newest first with hasResult and total, scoped to the user", () => {
    const { items, total } = listDocuments(seeded(), "u1", { limit: 2 });
    expect(total).toBe(4);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(items[0].hasResult).toBe(true);
    expect(items[1].hasResult).toBe(false);
    expect("resultEnc" in items[0]).toBe(false);
    expect(listDocuments(seeded(), "u1", { limit: 2, offset: 2 }).items.map((i) => i.id)).toEqual(["c", "d"]);
  });
  it("filters by type, verdict, status, engine, source and a date range", () => {
    const d = seeded();
    recordDocument(d, { ...base, id: "e", status: 200, mode: "local", createdAt: at(5), docType: "cheque", verdict: "partial", source: "api", backend: "ollama" });
    recordDocument(d, { ...base, id: "p", status: PENDING_STATUS, mode: "local", createdAt: at(0), backend: "anthropic" });
    const ids = (filters: Parameters<typeof listDocuments>[2] extends { filters?: infer F } | undefined ? F : never) => listDocuments(d, "u1", { filters }).items.map((i) => i.id);
    expect(ids({ family: "cheque" })).toEqual(["b", "e"]);
    expect(ids({ verdict: "verified" })).toEqual(["a"]);
    expect(ids({ status: "ok" })).toEqual(["a", "b", "e", "d"]);
    expect(ids({ status: "pending" })).toEqual(["p"]);
    expect(ids({ status: "failed" })).toEqual(["c"]);
    expect(ids({ backend: "ollama" })).toEqual(["e"]);
    expect(ids({ source: "api" })).toEqual(["e"]);
    expect(ids({ from: at(3).slice(0, 10), to: at(2).slice(0, 10) })).toEqual(["b", "c"]);
    expect(ids({ family: "cheque", source: "ui" })).toEqual(["b"]);
    expect(listDocuments(d, "u1", { filters: { family: "cheque" } }).total).toBe(2);
  });
  it("a family filter matches every region type of the family", () => {
    const d = seeded();
    recordDocument(d, { ...base, id: "s", status: 200, mode: "local", createdAt: at(5), docType: "teudat_zehut_sefach", verdict: "unverified" });
    recordDocument(d, { ...base, id: "cb", status: 200, mode: "local", createdAt: at(6), docType: "cheque_back", verdict: "unverified" });
    recordDocument(d, { ...base, id: "o", status: 200, mode: "local", createdAt: at(7), docType: "other" });
    recordDocument(d, { ...base, id: "n", status: 200, mode: "local", createdAt: at(8), docType: "not_a_document" });
    const ids = (family: string) => listDocuments(d, "u1", { filters: { family } }).items.map((i) => i.id);
    expect(ids("teudat_zehut")).toEqual(["a", "s", "d"]);
    expect(ids("cheque")).toEqual(["b", "cb"]);
    expect(ids("not_a_document")).toEqual(["o", "n"]);
    expect(ids("no_such_family")).toEqual([]);
  });
  it("documentFacets lists the families and distinct values of the user's own rows, in display order", () => {
    const d = seeded();
    recordDocument(d, { ...base, id: "e", status: 200, mode: "local", createdAt: at(5), docType: "cheque_back", verdict: "partial", source: "api", backend: "ollama" });
    recordDocument(d, { ...base, id: "o", status: 200, mode: "local", createdAt: at(7), docType: "other" });
    expect(documentFacets(d, "u1")).toEqual({ families: ["teudat_zehut", "cheque", "not_a_document"], verdicts: ["mismatch", "partial", "unverified", "verified"], backends: ["ollama"], sources: ["api", "ui"] });
    expect(documentFacets(d, "nobody")).toEqual({ families: [], verdicts: [], backends: [], sources: [] });
  });
  it("gets/deletes results only for the owner", () => {
    const d = seeded();
    expect(getDocumentResult(d, "u1", "a")).toEqual({ found: true, resultEnc: "v1:x:y:z" });
    expect(getDocumentResult(d, "u2", "a")).toEqual({ found: false, resultEnc: null });
    expect(deleteDocumentResult(d, "u2", "a")).toBe(false);
    expect(deleteDocumentResult(d, "u1", "a")).toBe(true);
    expect(getDocumentResult(d, "u1", "a")).toEqual({ found: true, resultEnc: null });
  });
  it("deleteAllResults clears only rows that had one", () => {
    const d = seeded();
    expect(deleteAllResults(d, "u1")).toBe(1);
    expect(deleteAllResults(d, "u1")).toBe(0);
  });
  it("usageSummary counts the UTC month", () => {
    const s = usageSummary(seeded(), "u1", WINDOW_MS, now);
    expect(s).toEqual({ month: "2026-09", docsThisMonth: 3, okThisMonth: 2, failedThisMonth: 1, total: 4, trialUsed: 0 });
  });
  it("dashboardStats aggregates successful rows, the type breakdown by family", () => {
    const d = seeded();
    const s = dashboardStats(d, "u1", now);
    expect(s.total).toBe(4);
    expect(s.last30Days).toBe(3);
    expect(s.medianLatencyMs).toBe(200);
    expect(s.byType).toEqual([{ key: "teudat_zehut", n: 2 }, { key: "cheque", n: 1 }]);
    recordDocument(d, { ...base, id: "s", status: 200, mode: "local", createdAt: at(5), docType: "teudat_zehut_sefach", verdict: "unverified" });
    recordDocument(d, { ...base, id: "cb", status: 200, mode: "local", createdAt: at(6), docType: "cheque_back", verdict: "unverified" });
    recordDocument(d, { ...base, id: "cb2", status: 200, mode: "local", createdAt: at(6), docType: "cheque_back", verdict: "unverified" });
    expect(dashboardStats(d, "u1", now).byType).toEqual([{ key: "cheque", n: 3 }, { key: "teudat_zehut", n: 3 }]);
    expect(s.byVerdict).toEqual([{ key: "mismatch", n: 1 }, { key: "unverified", n: 1 }, { key: "verified", n: 1 }]);
  });
  it("dashboardStats sums the cost of priced successful rows, null when no row was priced", () => {
    const d = seeded();
    expect(dashboardStats(d, "u1", now).costUsd).toEqual({ last30Days: null, total: null });
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
    recordDocument(d, { ...base, id: "p1", status: 200, mode: "trial", createdAt: at(1), docType: "cheque", costUsd: 0.04 });
    recordDocument(d, { ...base, id: "p2", status: 200, mode: "trial", createdAt: at(40), docType: "cheque", costUsd: 0.02 });
    recordDocument(d, { ...base, id: "p3", status: 502, mode: "trial", createdAt: at(1), errorCode: "ENGINE_ERROR", costUsd: 0.5 });
    const c = dashboardStats(d, "u1", now).costUsd;
    expect(c.last30Days).toBeCloseTo(0.04, 9);
    expect(c.total).toBeCloseTo(0.06, 9);
  });
  it("counts a document created at the exact start of the period as inside it", () => {
    const d = db();
    recordDocument(d, { ...base, id: "month-start", status: 200, mode: "local", createdAt: "2026-09-01T00:00:00.000Z", docType: "teudat_zehut", verdict: "verified" });
    expect(usageSummary(d, "u1", WINDOW_MS, now).docsThisMonth).toBe(1);

    const d2 = db();
    const exactly30DaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
    recordDocument(d2, { ...base, id: "30-days-ago", status: 200, mode: "local", createdAt: exactly30DaysAgo, docType: "teudat_zehut", verdict: "verified" });
    expect(dashboardStats(d2, "u1", now).last30Days).toBe(1);
  });
});

describe("DocumentMeta.registries", () => {
  it("is parsed from the column, and a malformed or absent value reads as null", () => {
    const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-dr-")), "t.sqlite3"));
    const base = { userId: "u", status: 200, mode: "local", source: "ui" } as const;
    recordDocument(db, { ...base, id: "a", createdAt: "2026-09-13T10:00:03Z", registries: JSON.stringify({ alerts: [{ source: "companies", by: "id", count: 1 }], infos: [] }) });
    recordDocument(db, { ...base, id: "b", createdAt: "2026-09-13T10:00:02Z", registries: "{oops" });
    recordDocument(db, { ...base, id: "c", createdAt: "2026-09-13T10:00:01Z" });
    expect(listDocuments(db, "u").items.map((d) => d.registries)).toEqual([{ alerts: [{ source: "companies", by: "id", count: 1 }], infos: [] }, null, null]);
  });
});

describe("pending window and sweep", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  it("the window is the engine timeout plus a minute", () => {
    expect(pendingWindowMs(600_000)).toBe(660_000);
  });
  it("reserveTrial honours the window it is given", () => {
    const d = db();
    const old = new Date(now.getTime() - 130_000).toISOString();
    startDocument(d, { ...base, id: "p", mode: "trial", createdAt: old });
    expect(reserveTrial(d, "u1", 1, { ...base, id: "q", mode: "trial", createdAt: now.toISOString() }, now, 120_000)).toBe(true);
    expect(reserveTrial(d, "u1", 1, { ...base, id: "r", mode: "trial", createdAt: now.toISOString() }, now, 200_000)).toBe(false);
  });
  it("sweepStalePending closes only rows older than the window", () => {
    const d = db();
    startDocument(d, { ...base, id: "fresh", mode: "local", createdAt: new Date(now.getTime() - 1_000).toISOString() });
    startDocument(d, { ...base, id: "stale", mode: "local", createdAt: new Date(now.getTime() - 700_000).toISOString() });
    expect(sweepStalePending(d, 660_000, now)).toBe(1);
    const rows = Object.fromEntries(d.select().from(documents).all().map((r) => [r.id, r]));
    expect(rows.fresh.status).toBe(PENDING_STATUS);
    expect(rows.stale).toMatchObject({ status: 500, errorCode: "INTERRUPTED" });
  });
});
