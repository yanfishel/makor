import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";

/**
 * The downloaded registries: a file of its own next to makor.sqlite3. The data is large and
 * fully rebuildable, so it stays out of the accounts database and its backups; there are no
 * migrations — each loader creates its tables, `sources` is the one fixed table.
 */
export type RegistriesDb = Database.Database;

/** Also the refresh order: the small, fast sources first, the companies registry last. */
export const SOURCE_IDS = ["boi_accounts", "boi_severe", "nbctf_individuals", "nbctf_orgs", "companies"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];
export const FIELDS = ["id", "bank", "branch", "account", "name"] as const;
export type Field = (typeof FIELDS)[number];
/** The search fields each source carries; a query reaches a source only if it carries all filled fields. */
export const SOURCE_FIELDS: Record<SourceId, readonly Field[]> = {
  boi_accounts: ["bank", "branch", "account"],
  boi_severe: ["id", "name"],
  nbctf_individuals: ["id", "name"],
  nbctf_orgs: ["id", "name"],
  companies: ["id", "name"],
};

export type SourceState = "never" | "running" | "ok" | "error" | "interrupted";
export interface SourceStatus {
  id: SourceId; status: SourceState; dataDate: string | null; fetchedAt: string | null;
  rowCount: number | null; durationMs: number | null; error: string | null; startedAt: string | null;
}

export const FTS_OPTIONS = "tokenize = 'unicode61 remove_diacritics 2'";

export function openRegistriesDb(file: string): RegistriesDb {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec("create table if not exists sources (id text primary key, status text not null, data_date text, fetched_at text, row_count integer, duration_ms integer, error text, started_at text)");
  // A process that died mid-refresh left its source "running" forever otherwise.
  db.prepare("update sources set status = 'interrupted' where status = 'running'").run();
  return db;
}

// Survives Next dev's module re-imports, as getDb() does.
const g = globalThis as unknown as { __makorRegistriesDb?: RegistriesDb };
export function getRegistriesDb(): RegistriesDb {
  g.__makorRegistriesDb ??= openRegistriesDb(path.join(getConfig().dataDir, "registries.sqlite3"));
  return g.__makorRegistriesDb;
}

interface SourceRow { id: string; status: SourceState; data_date: string | null; fetched_at: string | null; row_count: number | null; duration_ms: number | null; error: string | null; started_at: string | null }

export function listSources(db: RegistriesDb): SourceStatus[] {
  const rows = new Map((db.prepare("select * from sources").all() as SourceRow[]).map((r) => [r.id, r]));
  return SOURCE_IDS.map((id) => {
    const r = rows.get(id);
    return r
      ? { id, status: r.status, dataDate: r.data_date, fetchedAt: r.fetched_at, rowCount: r.row_count, durationMs: r.duration_ms, error: r.error, startedAt: r.started_at }
      : { id, status: "never", dataDate: null, fetchedAt: null, rowCount: null, durationMs: null, error: null, startedAt: null };
  });
}

export function markRunning(db: RegistriesDb, id: SourceId, now: Date): void {
  db.prepare("insert into sources (id, status, started_at) values (?, 'running', ?) on conflict(id) do update set status = 'running', started_at = excluded.started_at").run(id, now.toISOString());
}

/** Keeps data_date, fetched_at and row_count: they still describe the data the tables hold. */
export function markFailed(db: RegistriesDb, id: SourceId, error: string): void {
  db.prepare("update sources set status = 'error', error = ? where id = ?").run(error, id);
}

export function markOk(db: RegistriesDb, id: SourceId, r: { dataDate: string | null; rowCount: number; durationMs: number }, now: Date): void {
  db.prepare("update sources set status = 'ok', data_date = ?, fetched_at = ?, row_count = ?, duration_ms = ?, error = null where id = ?")
    .run(r.dataDate, now.toISOString(), r.rowCount, r.durationMs, id);
}

/** A renamed `_new` table keeps its index names, so a fixed name would collide with the live
 * table's index on the next refresh; a random token keeps every generation distinct. */
export const indexName = (table: string) => `ix_${table}_${randomUUID().slice(0, 8)}`;

export function dropNewTables(db: RegistriesDb, tables: readonly string[]): void {
  for (const t of tables) db.exec(`drop table if exists "${t}_new"`);
}

/** Call inside a transaction: readers on other connections keep the previous snapshot (WAL). */
export function swapTables(db: RegistriesDb, tables: readonly string[]): void {
  for (const t of tables) {
    db.exec(`drop table if exists "${t}"`);
    db.exec(`alter table "${t}_new" rename to "${t}"`);
  }
}
