import { getConfig } from "@/lib/config";
import { getRegistriesDb } from "@/lib/registries/db";
import { startRefresh } from "@/lib/registries/refresh";
import { nextRefreshAt, type RefreshAt } from "@/lib/registries/refresh-time";

type Timer = unknown;

export interface ScheduleOptions {
  at: RefreshAt;
  /** Starts a refresh; false when one is already running. */
  run: () => boolean;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  log?: Pick<Console, "info" | "error">;
}

/**
 * One timer at a time: armed for the next run, and re-armed for the day after as soon as it fires,
 * whatever the refresh does. No interval — the delay is recomputed from the clock each time, so a
 * restart, a slow night or a clock change never makes the runs drift. Returns a stop function.
 */
export function scheduleDailyRefresh(opts: ScheduleOptions): () => void {
  const now = opts.now ?? (() => new Date());
  const setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; });
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const log = opts.log ?? console;
  let timer: Timer;

  const arm = (after: number) => {
    const next = nextRefreshAt(new Date(after), opts.at);
    log.info(`registries: next scheduled refresh at ${next.toISOString()}`);
    timer = setTimer(() => fire(next.getTime()), Math.max(0, next.getTime() - now().getTime()));
  };
  const fire = (due: number) => {
    try {
      if (!opts.run()) log.info("registries: scheduled refresh skipped, a refresh is already running");
    } catch (err) {
      log.error(`registries: scheduled refresh failed to start: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // From whichever is later, the clock or the due time: a timer that fires a few ms early
      // would otherwise find tonight's run still ahead and run it twice.
      arm(Math.max(now().getTime(), due));
    }
  };

  arm(now().getTime());
  return () => clearTimer(timer);
}

// One schedule per process, kept on globalThis like the refresh run itself, so a second
// register() (Next dev) does not arm a second timer.
const g = globalThis as unknown as { __makorRegistriesSchedule?: () => void };

/** Called once at server start (instrumentation.ts): arms the daily refresh when MAKOR_REGISTRIES_REFRESH_AT is set. */
export function startRegistriesSchedule(): void {
  const at = getConfig().registriesRefreshAt;
  if (!at || g.__makorRegistriesSchedule) return;
  // The same call as the admin's button, so the one-run-per-process guard covers both.
  g.__makorRegistriesSchedule = scheduleDailyRefresh({ at, run: () => startRefresh(getRegistriesDb(), fetch) !== null });
}
