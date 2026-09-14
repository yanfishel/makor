import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuthError } from "@/lib/auth";
import type { Principal } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { openDb } from "@/lib/db";
import { openRegistriesDb, SOURCE_IDS, type RegistriesDb } from "@/lib/registries/db";
import { refreshIdle, refreshSource } from "@/lib/registries/refresh";
import { SOURCES } from "@/lib/registries/sources";
import { handleApiRegistriesSearch, handleRegistriesRefresh, handleRegistriesStatus, type ApiSearchDeps, type RegistriesDeps } from "@/lib/registries-handlers";
import { ensureUser } from "@/lib/users";
import { RateLimiter } from "@/lib/rate-limit";
import { fixtureHttp, httpOf, tableSource, tmpRegistriesFile } from "./registries-fixtures";

const T0 = new Date("2026-09-13T12:00:00Z");
const masterKey = randomBytes(32);
function setup(principal: Principal, sources = [tableSource("boi_severe", "x")]): RegistriesDeps {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-regh-")), "t.sqlite3"));
  ensureUser(db, "user_admin", T0);
  ensureUser(db, "user_plain", T0);
  return {
    db, masterKey, principal: async () => principal, now: () => T0,
    config: getConfig({ AUTH_MODE: "clerk", ENGINE_URL: "http://e", ENGINE_SECRET: "s", MAKOR_MASTER_KEY: masterKey.toString("base64"), DATA_DIR: "/x", TRIAL_DOCS: "3", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y" }),
    registries: openRegistriesDb(tmpRegistriesFile()), http: httpOf({}), sources,
  };
}
const admin: Principal = { userId: "user_admin", apiKeyId: null, via: "session" };
const plain: Principal = { userId: "user_plain", apiKeyId: null, via: "session" };
const viaKey: Principal = { userId: "user_admin", apiKeyId: "k1", via: "api" };
const get = () => new Request("http://x/api/registries");
const post = () => new Request("http://x/api/admin/registries/refresh", { method: "POST" });

describe("registries handlers", () => {
  it("status is for every session user; an API key is refused; refresh stays admin-only", async () => {
    const plainDeps = setup(plain);
    const status = await handleRegistriesStatus(get(), plainDeps);
    expect(status.status).toBe(200);
    expect((await status.json()).sources).toHaveLength(5);
    expect((await (await handleRegistriesStatus(get(), setup(viaKey))).json()).error).toBe("SESSION_REQUIRED");
    expect((await (await handleRegistriesRefresh(post(), plainDeps)).json()).error).toBe("ADMIN_REQUIRED");
  });

  it("status lists the five sources and the run state", async () => {
    const body = await (await handleRegistriesStatus(get(), setup(admin))).json();
    expect(body.running).toBe(false);
    expect(body.sources.map((s: { id: string }) => s.id)).toEqual([...SOURCE_IDS]);
  });

  it("refresh answers 202, then 409 while the run is going, and the run records its source", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = setup(admin, [tableSource("boi_severe", "x", gate)]);
    expect((await handleRegistriesRefresh(post(), deps)).status).toBe(202);
    const second = await handleRegistriesRefresh(post(), deps);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("REFRESH_RUNNING");
    expect((await (await handleRegistriesStatus(get(), deps)).json()).running).toBe(true);
    release();
    await refreshIdle();
    const body = await (await handleRegistriesStatus(get(), deps)).json();
    expect(body.running).toBe(false);
    expect(body.sources.find((s: { id: string }) => s.id === "boi_severe").status).toBe("ok");
  });
});

describe("GET /api/v1/registries/search", () => {
  let loaded: RegistriesDb;
  beforeAll(async () => {
    loaded = openRegistriesDb(tmpRegistriesFile());
    for (const def of SOURCES) await refreshSource(loaded, def, fixtureHttp());
  });
  const searchDeps = (principal: Principal, registriesDb: () => RegistriesDb): ApiSearchDeps => ({ ...setup(principal), registriesDb });
  const search = (qs: string) => new Request(`http://x/api/v1/registries/search?${qs}`);
  type Group = { source: string; loaded: boolean; total: number; rows: unknown[]; fetched_at: string | null };

  it("an API key finds a company by number: the sources with results first, rows as the search module's records, the skipped source named", async () => {
    const res = await handleApiRegistriesSearch(search("id=51-000000-3"), searchDeps(viaKey, () => loaded));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups.map((g: Group) => [g.source, g.total])).toEqual([["boi_severe", 1], ["nbctf_orgs", 1], ["companies", 1], ["nbctf_individuals", 0]]);
    expect(body.groups.find((g: Group) => g.source === "companies")).toMatchObject({ loaded: true, name_only: false, rows: [{ number: 510000003 }] });
    expect(typeof body.groups[0].fetched_at).toBe("string");
    expect(body.skipped).toEqual([{ source: "boi_accounts", missing: ["id"] }]);
  });

  it("a query with nothing to search on is 400 INVALID_QUERY, and the database is not opened", async () => {
    const res = await handleApiRegistriesSearch(search("bank=11"), searchDeps(viaKey, () => { throw new Error("must not be opened"); }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_QUERY");
  });

  it("registries never downloaded: 200, every searched source unloaded and empty", async () => {
    const empty = openRegistriesDb(tmpRegistriesFile());
    const body = await (await handleApiRegistriesSearch(search("name=%D7%93%D7%95%D7%92%D7%9E%D7%94"), searchDeps(plain, () => empty))).json();
    expect(body.groups).toHaveLength(4);
    expect(body.groups.every((g: Group) => !g.loaded && g.total === 0 && g.rows.length === 0)).toBe(true);
  });

  it("a bad token is 401 before the database is opened", async () => {
    const deps = searchDeps(plain, () => { throw new Error("must not be opened"); });
    deps.principal = async () => { throw new AuthError("TOKEN_INVALID", "bad key"); };
    expect((await handleApiRegistriesSearch(search("id=510000003"), deps)).status).toBe(401);
  });

  it("the search spends its own, lower budget, apart from the rest of /api/v1", async () => {
    const deps = searchDeps(viaKey, () => loaded);
    deps.limiter = new RateLimiter(() => 0);
    deps.config = { ...deps.config, apiSearchRateLimitPerMin: 1, apiRateLimitPerMin: 1 };
    expect((await handleApiRegistriesSearch(search("id=510000003"), deps)).status).toBe(200);
    const refused = await handleApiRegistriesSearch(search("id=510000003"), deps);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
    expect(deps.limiter.take("api:key:k1", 1).ok).toBe(true); // the general budget's single request is still there
  });
});
