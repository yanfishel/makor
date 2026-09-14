import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { documents, userSettings } from "@/lib/db/schema";
import { startDocument, PENDING_STATUS } from "@/lib/documents";

function tmpDb() {
  return openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-db-")), "nested", "t.sqlite3"));
}

describe("openDb", () => {
  it("creates the schema and accepts rows", () => {
    const db = tmpDb();
    db.insert(userSettings).values({ userId: "local", updatedAt: "2026-09-06T00:00:00Z" }).run();
    db.insert(documents).values({ id: "d1", userId: "local", createdAt: "2026-09-06T00:00:00Z", status: 200, mode: "local", source: "ui" }).run();
    const rows = db.select().from(documents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].sefach).toBe(false);
    expect(db.select().from(userSettings).all()[0].storeResults).toBe(false);
  });
  it("is idempotent on an existing file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "makor-db-"));
    const file = path.join(dir, "t.sqlite3");
    openDb(file);
    expect(() => openDb(file)).not.toThrow();
  });
  it("openDb leaves rows alone; the sweep is getDb's job", () => {
    const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-db-")), "t.sqlite3"));
    startDocument(db, { id: "a", userId: "u", mode: "local", source: "ui", createdAt: "2020-01-01T00:00:00.000Z" });
    expect(db.select().from(documents).all()[0].status).toBe(PENDING_STATUS);
  });
});

describe("getDb", () => {
  it("sweeps stale pending rows once, using DATA_DIR and ENGINE_TIMEOUT_MS from the environment", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "makor-getdb-"));
    const seed = openDb(path.join(dir, "makor.sqlite3"));
    const now = Date.now();
    startDocument(seed, { id: "stale", userId: "u", mode: "local", source: "ui", createdAt: new Date(now - 200_000).toISOString() });
    startDocument(seed, { id: "fresh", userId: "u", mode: "local", source: "ui", createdAt: new Date(now - 30_000).toISOString() });
    const g = globalThis as unknown as { __makorDb?: unknown };
    const saved = { db: g.__makorDb, dataDir: process.env.DATA_DIR, timeout: process.env.ENGINE_TIMEOUT_MS };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      delete g.__makorDb;
      process.env.DATA_DIR = dir;
      process.env.ENGINE_TIMEOUT_MS = "60000"; // window = 120 s: "stale" (200 s) is closed, "fresh" (30 s) kept
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      const rows = Object.fromEntries(db.select().from(documents).all().map((r) => [r.id, r]));
      expect(rows.stale).toMatchObject({ status: 500, errorCode: "INTERRUPTED" });
      expect(rows.fresh.status).toBe(PENDING_STATUS);
      expect(log).toHaveBeenCalledTimes(1);
      expect(getDb()).toBe(db); // cached: a second call neither reopens nor re-sweeps
    } finally {
      g.__makorDb = saved.db;
      if (saved.dataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = saved.dataDir;
      if (saved.timeout === undefined) delete process.env.ENGINE_TIMEOUT_MS; else process.env.ENGINE_TIMEOUT_MS = saved.timeout;
      log.mockRestore();
    }
  });
});
