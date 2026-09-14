import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { pendingWindowMs, sweepStalePending } from "@/lib/documents";
import * as schema from "./schema";

// drizzle() hands back the better-sqlite3 handle as $client; the plain
// BetterSQLite3Database type drops it, and tests read raw rows through it.
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** Open (creating if needed) the SQLite file, switch to WAL and apply migrations. */
export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

// Next dev re-imports modules on every HMR pass; a module-level variable would leak a
// new better-sqlite3 handle each time. globalThis survives re-imports.
const g = globalThis as unknown as { __makorDb?: Db };

export function getDb(): Db {
  if (!g.__makorDb) {
    const cfg = getConfig();
    const db = openDb(path.join(cfg.dataDir, "makor.sqlite3"));
    const swept = sweepStalePending(db, pendingWindowMs(cfg.engineTimeoutMs));
    if (swept) console.error(`documents: closed ${swept} pending row(s) left by a previous process`);
    g.__makorDb = db;
  }
  return g.__makorDb;
}
