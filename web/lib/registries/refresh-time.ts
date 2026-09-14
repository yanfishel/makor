/* The daily refresh's clock, with no imports: lib/config.ts parses the setting with it, and the
 * scheduler (schedule.ts, which needs the database) computes its runs with it. */

/** The registries publish on Israeli business days, so the schedule keeps Israeli wall-clock time across the clock changes. */
export const REFRESH_TIME_ZONE = "Asia/Jerusalem";

export interface RefreshAt { hour: number; minute: number }

/** "HH:MM" on a 24-hour clock, or null. */
export function parseRefreshAt(raw: string): RefreshAt | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/** How far the zone's wall clock is ahead of UTC at that instant, in ms. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The first instant strictly after `now` at which the zone's clock reads `at`. The wall time is
 * turned into UTC with the offset in force at that moment, looked up twice so a clock change
 * between `now` and the run is taken into account. (A time inside a spring-forward gap would land
 * an hour off; Israel's gap is 02:00–03:00, so the default 03:30 never falls in it.)
 */
export function nextRefreshAt(now: Date, at: RefreshAt, timeZone: string = REFRESH_TIME_ZONE): Date {
  const today = new Date(now.getTime() + zoneOffsetMs(now.getTime(), timeZone));
  for (let days = 0; days < 3; days++) {
    const wall = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days, at.hour, at.minute);
    let instant = wall - zoneOffsetMs(wall, timeZone);
    instant = wall - zoneOffsetMs(instant, timeZone);
    if (instant > now.getTime()) return new Date(instant);
  }
  throw new Error("nextRefreshAt: no run within three days"); // unreachable: tomorrow's time is always later
}
