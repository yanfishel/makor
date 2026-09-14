import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";

const base = { AUTH_MODE: "none", ENGINE_URL: "http://127.0.0.1:8000", DATA_DIR: "/tmp/x" };

describe("getConfig", () => {
  it("parses the none mode with defaults", () => {
    const c = getConfig(base);
    expect(c.authMode).toBe("none");
    expect(c.engineUrl).toBe("http://127.0.0.1:8000");
    expect(c.engineSecret).toBe("");
    expect(c.trialDocs).toBe(5);
    expect(c.masterKeyB64).toBeNull();
    expect(c.siteUrl).toBe("http://localhost:3000");
    expect(c.engineTimeoutMs).toBe(600_000);
  });
  it("strips a trailing slash from ENGINE_URL", () => {
    expect(getConfig({ ...base, ENGINE_URL: "http://engine:8000/" }).engineUrl).toBe("http://engine:8000");
  });
  it("rejects an unknown AUTH_MODE", () => {
    expect(() => getConfig({ ...base, AUTH_MODE: "magic" })).toThrow(/AUTH_MODE/);
  });
  it("requires the master key in clerk mode", () => {
    expect(() => getConfig({ ...base, AUTH_MODE: "clerk" })).toThrow(/MAKOR_MASTER_KEY/);
  });
  it("requires the engine secret in clerk mode", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(() => getConfig({ ...base, AUTH_MODE: "clerk", MAKOR_MASTER_KEY: key })).toThrow(/ENGINE_SECRET/);
  });
  it("rejects a non-numeric TRIAL_DOCS", () => {
    expect(() => getConfig({ ...base, TRIAL_DOCS: "five" })).toThrow(/TRIAL_DOCS/);
  });
  it("rejects a non-numeric ENGINE_TIMEOUT_MS", () => {
    expect(() => getConfig({ ...base, ENGINE_TIMEOUT_MS: "abc" })).toThrow(/ENGINE_TIMEOUT_MS/);
  });
  it("reads the API rate limits per minute: 30 and 20 by default, 0 turns one off, anything else is refused", () => {
    expect(getConfig(base)).toMatchObject({ apiRateLimitPerMin: 30, apiSearchRateLimitPerMin: 20 });
    expect(getConfig({ ...base, API_RATE_LIMIT_PER_MIN: "0", API_SEARCH_RATE_LIMIT_PER_MIN: "5" })).toMatchObject({ apiRateLimitPerMin: 0, apiSearchRateLimitPerMin: 5 });
    expect(getConfig({ ...base, API_RATE_LIMIT_PER_MIN: "", API_SEARCH_RATE_LIMIT_PER_MIN: " " })).toMatchObject({ apiRateLimitPerMin: 30, apiSearchRateLimitPerMin: 20 });
    expect(() => getConfig({ ...base, API_RATE_LIMIT_PER_MIN: "-1" })).toThrow(/API_RATE_LIMIT_PER_MIN/);
    expect(() => getConfig({ ...base, API_SEARCH_RATE_LIMIT_PER_MIN: "ten" })).toThrow(/API_SEARCH_RATE_LIMIT_PER_MIN/);
  });
  it("rejects a zero ENGINE_TIMEOUT_MS", () => {
    expect(() => getConfig({ ...base, ENGINE_TIMEOUT_MS: "0" })).toThrow(/ENGINE_TIMEOUT_MS/);
  });
  it("clerk mode requires both Clerk keys and exposes them", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    const clerk = { ...base, AUTH_MODE: "clerk", MAKOR_MASTER_KEY: key, ENGINE_SECRET: "s" };
    expect(() => getConfig(clerk)).toThrow(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
    expect(() => getConfig({ ...clerk, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x" })).toThrow(/CLERK_SECRET_KEY/);
    const c = getConfig({ ...clerk, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y" });
    expect(c.clerkPublishableKey).toBe("pk_test_x");
    expect(c.clerkSecretKey).toBe("sk_test_y");
    expect(getConfig(base).clerkPublishableKey).toBeNull();
  });
  it("MAKOR_ADMIN_EMAIL is trimmed and lower-cased; blank is null", () => {
    expect(getConfig({ MAKOR_ADMIN_EMAIL: "  Admin@Example.com " }).adminEmail).toBe("admin@example.com");
    expect(getConfig({ MAKOR_ADMIN_EMAIL: " " }).adminEmail).toBeNull();
    expect(getConfig({}).adminEmail).toBeNull();
  });
});
