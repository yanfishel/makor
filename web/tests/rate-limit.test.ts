import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  it("lets a burst of the per-minute limit through, then refuses with the seconds until one more request", () => {
    let t = 0;
    const limiter = new RateLimiter(() => t);
    for (let i = 0; i < 10; i++) expect(limiter.take("k", 10)).toEqual({ ok: true });
    expect(limiter.take("k", 10)).toEqual({ ok: false, retryAfterSec: 6 });
    t = 5_999;
    expect(limiter.take("k", 10).ok).toBe(false);
    t = 6_000;
    expect(limiter.take("k", 10)).toEqual({ ok: true });
    expect(limiter.take("k", 10).ok).toBe(false);
  });

  it("refills at the per-minute rate up to the limit, never beyond", () => {
    let t = 0;
    const limiter = new RateLimiter(() => t);
    for (let i = 0; i < 30; i++) limiter.take("k", 30);
    t = 10 * 60_000;
    for (let i = 0; i < 30; i++) expect(limiter.take("k", 30).ok).toBe(true);
    expect(limiter.take("k", 30).ok).toBe(false);
  });

  it("counts every key on its own", () => {
    const limiter = new RateLimiter(() => 0);
    expect(limiter.take("a", 1).ok).toBe(true);
    expect(limiter.take("a", 1).ok).toBe(false);
    expect(limiter.take("b", 1).ok).toBe(true);
  });

  it("forgets idle keys once it holds more than its cap, without losing a live one's count", () => {
    let t = 0;
    const limiter = new RateLimiter(() => t, 2);
    limiter.take("old1", 1);
    limiter.take("old2", 1);
    t = 61_000;
    limiter.take("live", 1);
    expect(limiter.size).toBe(1);
    expect(limiter.take("live", 1).ok).toBe(false);
  });
});
