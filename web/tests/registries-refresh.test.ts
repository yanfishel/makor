import { describe, expect, it, vi } from "vitest";
import { listSources, openRegistriesDb, type SourceStatus } from "@/lib/registries/db";
import { refreshIdle, refreshSource, refreshState, startRefresh } from "@/lib/registries/refresh";
import { SOURCES } from "@/lib/registries/sources";
import type { SourceDef } from "@/lib/registries/sources/types";
import { summarizeRun } from "@/lib/registries/summary";
import { failingSource, fixtureHttp, httpOf, tableSource, tmpRegistriesFile } from "./registries-fixtures";

const noHttp = httpOf({});
const status = (db: ReturnType<typeof openRegistriesDb>, id: string) => listSources(db).find((s) => s.id === id)!;
const tables = (db: ReturnType<typeof openRegistriesDb>) => (db.prepare("select name from sqlite_master where type = 'table' and name like 'boi_severe%'").all() as { name: string }[]).map((r) => r.name);

describe("refreshSource", () => {
  it("swaps a successful load in and records it", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    expect(await refreshSource(db, tableSource("boi_severe", "first"), noHttp, () => new Date("2026-09-13T10:00:00Z"))).toBe(true);
    expect(db.prepare("select v from boi_severe").all()).toEqual([{ v: "first" }]);
    expect(status(db, "boi_severe")).toMatchObject({ status: "ok", dataDate: "2026-09-10", rowCount: 1, fetchedAt: "2026-09-13T10:00:00.000Z", error: null });
  });

  it("keeps the previous data when a load fails, and leaves no _new table behind", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    await refreshSource(db, tableSource("boi_severe", "first"), noHttp);
    expect(await refreshSource(db, failingSource("boi_severe", "HTTP 503"), noHttp)).toBe(false);
    expect(db.prepare("select v from boi_severe").all()).toEqual([{ v: "first" }]);
    expect(status(db, "boi_severe")).toMatchObject({ status: "error", error: "HTTP 503", rowCount: 1 });
    expect(tables(db)).toEqual(["boi_severe"]);
  });

  it("treats a load with zero rows as an error", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    const empty = { ...tableSource("boi_severe", "x"), load: async (d: typeof db) => { d.exec("create table boi_severe_new (v text)"); return { rowCount: 0, dataDate: null }; } };
    expect(await refreshSource(db, empty, noHttp)).toBe(false);
    expect(status(db, "boi_severe")).toMatchObject({ status: "error", error: "the source returned no rows" });
  });

  it("loads every real source from the synthetic fixtures", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    for (const def of SOURCES) expect(await refreshSource(db, def, fixtureHttp())).toBe(true);
    expect(listSources(db).map((s) => [s.id, s.status, s.rowCount])).toEqual([
      ["boi_accounts", "ok", 2], ["boi_severe", "ok", 2], ["nbctf_individuals", "ok", 2], ["nbctf_orgs", "ok", 1], ["companies", "ok", 3],
    ]);
  });
});

describe("startRefresh", () => {
  it("runs sources in order, refuses a second run meanwhile, and survives a failing source", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = startRefresh(db, noHttp, [failingSource("boi_accounts", "boom"), tableSource("boi_severe", "x", gate)]);
    expect(run).not.toBeNull();
    expect(refreshState().running).toBe(true);
    expect(refreshState().runStartedAt).not.toBeNull();
    expect(startRefresh(db, noHttp, [])).toBeNull();
    release();
    await refreshIdle();
    expect(refreshState().running).toBe(false);
    expect(listSources(db).slice(0, 2).map((s) => s.status)).toEqual(["error", "ok"]);
    expect(summarizeRun(listSources(db), refreshState().runStartedAt)).toEqual({ ok: ["boi_severe"], failed: ["boi_accounts"] });
  });
});

describe("startRefresh with a failure path that itself throws", () => {
  it("logs 'run aborted' and settles cleanly instead of leaving an unhandled rejection", async () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    // The simplest honest way to make refreshSource's own catch throw: a `tables` getter
    // that succeeds on the first read (the pre-load dropNewTables) and throws on the
    // second (the post-failure dropNewTables inside refreshSource's catch).
    let reads = 0;
    const brokenSource: SourceDef = {
      id: "boi_severe",
      get tables() {
        reads += 1;
        if (reads > 1) throw new Error("tables getter blew up");
        return ["boi_severe"];
      },
      async load(d) {
        d.exec("create table boi_severe_new (v text)");
        throw new Error("load failed");
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = startRefresh(db, noHttp, [brokenSource]);
    expect(run).not.toBeNull();
    await expect(run).resolves.toBeUndefined();
    await refreshIdle();
    expect(refreshState().running).toBe(false);
    expect(errorSpy.mock.calls.map((c) => c[0])).toContain("registries: run aborted at boi_severe: tables getter blew up");
    errorSpy.mockRestore();
  });
});

describe("summarizeRun", () => {
  const s = (id: SourceStatus["id"], status: SourceStatus["status"], startedAt: string | null): SourceStatus =>
    ({ id, status, startedAt, dataDate: null, fetchedAt: null, rowCount: null, durationMs: null, error: null });
  it("counts only the sources the run touched", () => {
    const sources = [s("boi_accounts", "ok", "2026-09-13T10:00:01.000Z"), s("boi_severe", "error", "2026-09-12T10:00:00.000Z"), s("companies", "interrupted", "2026-09-13T10:00:05.000Z")];
    expect(summarizeRun(sources, "2026-09-13T10:00:00.000Z")).toEqual({ ok: ["boi_accounts"], failed: ["companies"] });
    expect(summarizeRun(sources, null)).toEqual({ ok: [], failed: [] });
  });
});
