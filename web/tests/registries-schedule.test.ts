import { describe, expect, it, vi } from "vitest";
import { getConfig } from "@/lib/config";
import { nextRefreshAt, parseRefreshAt } from "@/lib/registries/refresh-time";
import { scheduleDailyRefresh } from "@/lib/registries/schedule";

const at = { hour: 3, minute: 30 };

describe("parseRefreshAt", () => {
  it("reads HH:MM on a 24-hour clock", () => {
    expect(parseRefreshAt("03:30")).toEqual({ hour: 3, minute: 30 });
    expect(parseRefreshAt("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseRefreshAt("00:00")).toEqual({ hour: 0, minute: 0 });
  });

  it("rejects anything else", () => {
    for (const bad of ["3:30", "24:00", "03:60", "0330", "03:30:00", "noon"]) expect(parseRefreshAt(bad)).toBeNull();
  });
});

describe("config MAKOR_REGISTRIES_REFRESH_AT", () => {
  it("blank or unset turns the schedule off", () => {
    expect(getConfig({}).registriesRefreshAt).toBeNull();
    expect(getConfig({ MAKOR_REGISTRIES_REFRESH_AT: "  " }).registriesRefreshAt).toBeNull();
  });

  it("a time turns it on, a malformed one is an error rather than a silent off", () => {
    expect(getConfig({ MAKOR_REGISTRIES_REFRESH_AT: "03:30" }).registriesRefreshAt).toEqual(at);
    expect(() => getConfig({ MAKOR_REGISTRIES_REFRESH_AT: "3.30" })).toThrow(/MAKOR_REGISTRIES_REFRESH_AT/);
  });
});

describe("nextRefreshAt (Asia/Jerusalem)", () => {
  it("later the same day when the time has not come yet (winter, UTC+2)", () => {
    // 02:00 in Jerusalem → 03:30 the same day = 01:30 UTC.
    expect(nextRefreshAt(new Date("2026-01-10T00:00:00Z"), at).toISOString()).toBe("2026-01-10T01:30:00.000Z");
  });

  it("the next day once the time has passed (summer, UTC+3)", () => {
    // 04:00 in Jerusalem → tomorrow 03:30 = 00:30 UTC.
    expect(nextRefreshAt(new Date("2026-07-01T01:00:00Z"), at).toISOString()).toBe("2026-07-02T00:30:00.000Z");
  });

  it("exactly at the time means tomorrow, never now", () => {
    expect(nextRefreshAt(new Date("2026-07-02T00:30:00Z"), at).toISOString()).toBe("2026-07-03T00:30:00.000Z");
  });

  it("follows the clock change: the night summer time starts and the night it ends", () => {
    // Israel moves to UTC+3 on 27 March 2026 and back to UTC+2 on 25 October 2026, both at 02:00.
    expect(nextRefreshAt(new Date("2026-03-26T12:00:00Z"), at).toISOString()).toBe("2026-03-27T00:30:00.000Z");
    expect(nextRefreshAt(new Date("2026-10-24T12:00:00Z"), at).toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });
});

describe("scheduleDailyRefresh", () => {
  function harness(start: string) {
    let clock = new Date(start).getTime();
    const timers: { fn: () => void; ms: number }[] = [];
    const log = { info: vi.fn(), error: vi.fn() };
    return {
      timers, log,
      now: () => new Date(clock),
      setTimer: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
      clearTimer: vi.fn(),
      /** Moves the clock to the last armed timer's moment and fires it. */
      fire() { const t = timers.at(-1)!; clock += t.ms; t.fn(); },
    };
  }

  it("arms one timer for the next run, runs the refresh when it fires, then arms tomorrow's", () => {
    const h = harness("2026-07-01T20:00:00Z"); // 23:00 in Jerusalem
    const run = vi.fn(() => true);
    scheduleDailyRefresh({ at, run, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, log: h.log });
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(4.5 * 3600_000); // until 03:30
    expect(run).not.toHaveBeenCalled();

    h.fire();
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.timers).toHaveLength(2);
    expect(h.timers[1].ms).toBe(24 * 3600_000);
  });

  it("a run already going is logged as skipped, and tomorrow is still armed", () => {
    const h = harness("2026-07-01T20:00:00Z");
    scheduleDailyRefresh({ at, run: () => false, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, log: h.log });
    h.fire();
    expect(h.log.info).toHaveBeenCalledWith(expect.stringMatching(/skipped/));
    expect(h.timers).toHaveLength(2);
  });

  it("a refresh that throws does not stop the schedule", () => {
    const h = harness("2026-07-01T20:00:00Z");
    scheduleDailyRefresh({ at, run: () => { throw new Error("boom"); }, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, log: h.log });
    h.fire();
    expect(h.log.error).toHaveBeenCalled();
    expect(h.timers).toHaveLength(2);
  });

  it("a timer that fires a moment early never runs twice the same night", () => {
    const h = harness("2026-07-01T20:00:00Z");
    const run = vi.fn(() => true);
    scheduleDailyRefresh({ at, run, now: h.now, setTimer: (fn, ms) => h.setTimer(fn, ms - 5), clearTimer: h.clearTimer, log: h.log });
    h.fire(); // lands 5 ms before 03:30
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.timers[1].ms).toBeGreaterThan(23 * 3600_000);
  });

  it("the returned stop clears the armed timer", () => {
    const h = harness("2026-07-01T20:00:00Z");
    const stop = scheduleDailyRefresh({ at, run: () => true, now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer, log: h.log });
    stop();
    expect(h.clearTimer).toHaveBeenCalledWith(1);
  });
});
