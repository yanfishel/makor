/**
 * Requests per minute for the public API, per principal: a token bucket holding the minute's
 * limit and refilling at that rate, so a client may burst up to the limit and then gets one
 * request every 60/limit seconds. In memory, one process — the web app runs as a single Node
 * process; the counts reset on restart and are not shared between instances.
 */

const MINUTE_MS = 60_000;
/** Above this many tracked keys, keys idle for a full minute are dropped — a bucket idle that long has refilled, so dropping it loses nothing. */
const MAX_KEYS = 10_000;

export type TakeResult = { ok: true } | { ok: false; retryAfterSec: number };

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly now: () => number = Date.now, private readonly maxKeys = MAX_KEYS) {}

  get size(): number {
    return this.buckets.size;
  }

  /** Spends one request of `key`'s bucket, or says how many whole seconds until one is available. */
  take(key: string, perMinute: number): TakeResult {
    const t = this.now();
    const rate = perMinute / MINUTE_MS;
    const bucket = this.buckets.get(key) ?? { tokens: perMinute, at: t };
    bucket.tokens = Math.min(perMinute, bucket.tokens + (t - bucket.at) * rate);
    bucket.at = t;
    this.buckets.set(key, bucket);
    if (this.buckets.size > this.maxKeys) this.prune(t);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - bucket.tokens) / rate / 1000)) };
  }

  private prune(t: number): void {
    for (const [key, bucket] of this.buckets) if (t - bucket.at >= MINUTE_MS) this.buckets.delete(key);
  }
}

/** The process's one limiter for /api/v1/*, handed to handlers through `readDeps()`. */
export const apiLimiter = new RateLimiter();
