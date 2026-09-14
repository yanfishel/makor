import { dropNewTables, markFailed, markOk, markRunning, swapTables, type RegistriesDb } from "@/lib/registries/db";
import type { Http } from "@/lib/registries/fetch";
import { SOURCES } from "@/lib/registries/sources";
import type { SourceDef } from "@/lib/registries/sources/types";

/**
 * Refresh one source: load into `_new` tables, then swap them in with the status in one
 * transaction. Any failure — network, WAF page, parse, zero rows — drops the `_new` tables and
 * leaves the previous data serving searches. Logs the source id, outcome, rows and duration only.
 */
export async function refreshSource(db: RegistriesDb, def: SourceDef, http: Http, now: () => Date = () => new Date()): Promise<boolean> {
  const started = Date.now();
  markRunning(db, def.id, now());
  try {
    dropNewTables(db, def.tables);
    const result = await def.load(db, http);
    if (result.rowCount === 0) throw new Error("the source returned no rows");
    db.transaction(() => {
      swapTables(db, def.tables);
      markOk(db, def.id, { ...result, durationMs: Date.now() - started }, now());
    })();
    console.info(`registries: ${def.id} ok, ${result.rowCount} rows in ${Date.now() - started} ms`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dropNewTables(db, def.tables);
    markFailed(db, def.id, message);
    console.error(`registries: ${def.id} failed after ${Date.now() - started} ms: ${message}`);
    return false;
  }
}

// One run per process, kept on globalThis so Next dev's module re-imports see the same run.
const g = globalThis as unknown as { __makorRegistriesRun?: Promise<void> | null; __makorRegistriesRunStartedAt?: string | null };

export interface RefreshState { running: boolean; runStartedAt: string | null }

/** `runStartedAt` outlives the run, so the settings tab can tell which sources the last run touched. */
export const refreshState = (): RefreshState => ({ running: Boolean(g.__makorRegistriesRun), runStartedAt: g.__makorRegistriesRunStartedAt ?? null });

/** Starts every source in order in the background; null when a run is already going. A failed source does not stop the next. */
export function startRefresh(db: RegistriesDb, http: Http, sources: readonly SourceDef[] = SOURCES, now: () => Date = () => new Date()): Promise<void> | null {
  if (g.__makorRegistriesRun) return null;
  g.__makorRegistriesRunStartedAt = now().toISOString();
  const run = (async () => {
    for (const def of sources) {
      // refreshSource's own catch (markRunning, or dropNewTables/markFailed inside it) can
      // itself throw; without this the run would abort with an unhandled rejection instead
      // of settling and leaving a clean status behind.
      try {
        await refreshSource(db, def, http, now);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`registries: run aborted at ${def.id}: ${message}`);
        break;
      }
    }
  })().finally(() => { g.__makorRegistriesRun = null; });
  g.__makorRegistriesRun = run;
  return run;
}

/** Resolves when no run is going (tests, and nothing else, wait on it). */
export const refreshIdle = (): Promise<void> => g.__makorRegistriesRun ?? Promise.resolve();
