import type { RegistriesDb, SourceId } from "@/lib/registries/db";
import type { Http } from "@/lib/registries/fetch";

export interface LoadResult { rowCount: number; dataDate: string | null }

/**
 * One registry source. `load` downloads, parses and fills `<table>_new` for every name in
 * `tables` (creating them); the runner drops leftovers before and swaps the tables in after.
 */
export interface SourceDef {
  id: SourceId;
  tables: readonly string[];
  load(db: RegistriesDb, http: Http): Promise<LoadResult>;
}
