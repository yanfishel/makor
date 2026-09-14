import { describe, expect, it } from "vitest";
import { FTS_OPTIONS, SOURCE_IDS, dropNewTables, indexName, listSources, markFailed, markOk, markRunning, openRegistriesDb, swapTables } from "@/lib/registries/db";
import { tmpRegistriesFile } from "./registries-fixtures";

describe("registries db", () => {
  it("lists every source in refresh order, never-loaded ones as never", () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    expect(listSources(db).map((s) => [s.id, s.status])).toEqual(SOURCE_IDS.map((id) => [id, "never"]));
  });

  it("records running, ok and error without losing the last good numbers", () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    markRunning(db, "boi_severe", new Date("2026-09-13T10:00:00Z"));
    markOk(db, "boi_severe", { dataDate: "2026-09-10", rowCount: 3, durationMs: 120 }, new Date("2026-09-13T10:00:01Z"));
    markRunning(db, "boi_severe", new Date("2026-09-14T10:00:00Z"));
    markFailed(db, "boi_severe", "HTTP 503");
    expect(listSources(db).find((s) => s.id === "boi_severe")).toEqual({
      id: "boi_severe", status: "error", dataDate: "2026-09-10", fetchedAt: "2026-09-13T10:00:01.000Z",
      rowCount: 3, durationMs: 120, error: "HTTP 503", startedAt: "2026-09-14T10:00:00.000Z",
    });
  });

  it("turns a run left running by a previous process into interrupted on open", () => {
    const file = tmpRegistriesFile();
    markRunning(openRegistriesDb(file), "companies", new Date());
    expect(listSources(openRegistriesDb(file)).find((s) => s.id === "companies")?.status).toBe("interrupted");
  });

  it("swaps _new tables in, FTS included, and index names never collide across refreshes", () => {
    const db = openRegistriesDb(tmpRegistriesFile());
    for (const value of ["old", "new"]) {
      dropNewTables(db, ["t", "t_names"]);
      db.exec(`create table t_new (v text); create index ${indexName("t")} on t_new (v); create virtual table t_names_new using fts5(v, ${FTS_OPTIONS})`);
      db.prepare("insert into t_new values (?)").run(value);
      db.prepare("insert into t_names_new (rowid, v) values (1, ?)").run(value);
      db.transaction(() => swapTables(db, ["t", "t_names"]))();
    }
    expect(db.prepare("select v from t").all()).toEqual([{ v: "new" }]);
    expect(db.prepare("select rowid from t_names where t_names match ?").all('"new"*')).toEqual([{ rowid: 1 }]);
  });
});
