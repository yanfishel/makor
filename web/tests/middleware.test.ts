import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

// clerkMiddleware reads the Clerk keys when the module loads, so the fakes (shaped like
// Clerk's: the publishable key encodes the frontend API host) must exist before the import.
process.env.CLERK_SECRET_KEY ??= "sk_test_unit";
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= "pk_test_" + Buffer.from("clerk.example.com$").toString("base64");
const { middlewareFor } = await import("@/middleware");

const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const ev = {} as never;
// A middleware may legally answer "nothing, carry on" (NextMiddlewareResult includes
// null/undefined). Every path under test must answer, so this fails loudly instead of
// letting the assertions read headers off nothing.
const must = (res: Response | null | undefined | void, path: string): Response => {
  if (!res) throw new Error(`middleware returned no response for ${path}`);
  return res;
};

describe("middleware (none mode)", () => {
  const mw = middlewareFor("none");
  it("never localizes /api — passes straight through", async () => {
    for (const p of ["/api/keys", "/api/v1/usage", "/api/settings/engine-health"]) {
      const res = must(await mw(req(p), ev), p);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(res.headers.get("location")).toBeNull();
    }
  });
  it("still localizes pages, including one whose path merely starts with api", async () => {
    const res = must(await mw(req("/app"), ev), "/app");
    expect(res.headers.get("x-middleware-rewrite") ?? "").toContain("/en/app");
    const ref = must(await mw(req("/api-reference"), ev), "/api-reference");
    expect(ref.headers.get("x-middleware-rewrite") ?? "").toContain("/en/api-reference");
  });
  it("selects the handler by mode, not at import time", () => {
    expect(middlewareFor("clerk")).not.toBe(middlewareFor("none"));
  });
});

describe("middleware (clerk mode, signed-out request)", () => {
  const mw = middlewareFor("clerk");
  const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");
  it("passes /api straight through — Clerk may rewrite to the SAME path to attach its headers, never to a locale", async () => {
    for (const p of ["/api/keys", "/api/v1/usage"]) {
      const res = must(await mw(req(p), ev), p);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
      const rewrite = rewriteOf(res);
      if (rewrite !== null) expect(new URL(rewrite).pathname).toBe(p);
    }
  });
  it("does not serve /app to a signed-out request (auth.protect() rewrites it away)", async () => {
    const res = must(await mw(req("/app"), ev), "/app");
    expect(res.headers.get("x-clerk-auth-status")).toBe("signed-out");
    expect(res.headers.get("x-clerk-auth-reason") ?? "").toContain("protect");
    expect(new URL(rewriteOf(res) ?? "http://x/").pathname).not.toMatch(/^\/(en\/)?app$/);
  });
  it("still localizes a public page", async () => {
    const res = must(await mw(req("/api-reference"), ev), "/api-reference");
    expect(res.headers.get("x-clerk-auth-status")).toBe("signed-out");
    expect(new URL(rewriteOf(res) ?? "http://x/").pathname).toBe("/en/api-reference");
  });
});
