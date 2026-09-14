import { requireAdmin } from "@/lib/admin-handlers";
import { apiError, json } from "@/lib/http";
import { requireSession } from "@/lib/keys-handlers";
import { FIELDS, listSources, type RegistriesDb, type SourceId, type SourceStatus } from "@/lib/registries/db";
import type { Http } from "@/lib/registries/fetch";
import { refreshState, startRefresh, type RefreshState } from "@/lib/registries/refresh";
import { parseQuery, searchRegistries, type Skipped } from "@/lib/registries/search";
import type { SourceDef } from "@/lib/registries/sources/types";
import { withApiPrincipal, type ReadDeps } from "@/lib/usage-handlers";

export interface RegistriesDeps extends ReadDeps { registries: RegistriesDb; http: Http; sources?: readonly SourceDef[] }
export interface RegistriesStatusBody extends RefreshState { sources: SourceStatus[] }

/** GET /api/registries — the run state and every source's last refresh, for any signed-in user (the settings tab shows it to all). */
export const handleRegistriesStatus = async (request: Request, deps: RegistriesDeps) =>
  requireSession(request, deps, () => json(200, { ...refreshState(), sources: listSources(deps.registries) } satisfies RegistriesStatusBody));

/** POST /api/admin/registries/refresh — starts the run in the background and answers at once. */
export const handleRegistriesRefresh = async (request: Request, deps: RegistriesDeps) =>
  requireAdmin(request, deps, () =>
    startRefresh(deps.registries, deps.http, deps.sources) ? json(202, { running: true }) : apiError(409, "REFRESH_RUNNING", "A refresh is already running"));

export interface ApiSearchDeps extends ReadDeps { registriesDb: () => RegistriesDb }
export interface ApiSearchGroup { source: SourceId; loaded: boolean; data_date: string | null; fetched_at: string | null; total: number; name_only: boolean; rows: unknown[] }
export interface ApiSearchBody { groups: ApiSearchGroup[]; skipped: Skipped[] }

/** GET /api/v1/registries/search — the registries page's search for a key or a session: the
 * same query (id, bank, branch, account, name; ANDed, name words as prefixes), the same groups
 * (sources with results first, RESULT_LIMIT rows each with the true total). Not metered, and
 * nothing about the query is logged. The database opens only after the principal and the query pass. */
export const handleApiRegistriesSearch = (request: Request, deps: ApiSearchDeps) => withApiPrincipal(request, deps, "search", () => {
  const url = new URL(request.url);
  const parsed = parseQuery(Object.fromEntries(FIELDS.map((f) => [f, url.searchParams.getAll(f)])));
  // This is the page's `registries.tooShort` (messages/en.json) in English; keep the two wordings the same.
  if (!parsed.valid) return apiError(400, "INVALID_QUERY", "Fill in a number, an account, or at least two letters of a name. Bank and branch only narrow a search.");
  const today = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const result = searchRegistries(deps.registriesDb(), parsed, today);
  return json(200, {
    groups: result.groups.map((g) => ({ source: g.source, loaded: g.loaded, data_date: g.status.dataDate, fetched_at: g.status.fetchedAt, total: g.total, name_only: g.nameOnly, rows: g.rows })),
    skipped: result.skipped,
  } satisfies ApiSearchBody);
});
