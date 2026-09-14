import { describe, expect, it } from "vitest";
import { USER_AGENT, fetchBytes, fetchJson, type Http } from "@/lib/registries/fetch";

describe("registry fetch", () => {
  it("sends the honest user agent", async () => {
    let ua = "";
    const http: Http = async (_url, init) => {
      ua = new Headers(init?.headers).get("user-agent") ?? "";
      return new Response("{}", { headers: { "content-type": "application/json" } });
    };
    await fetchJson(http, "https://x.test/a");
    expect(ua).toBe(USER_AGENT);
  });
  it("refuses a non-2xx answer, an HTML page served as 200, and non-JSON where JSON is expected", async () => {
    await expect(fetchBytes(async () => new Response("no", { status: 503 }), "https://x.test/f")).rejects.toThrow(/HTTP 503/);
    await expect(fetchBytes(async () => new Response("<html>", { headers: { "content-type": "text/html; charset=utf-8" } }), "https://x.test/f")).rejects.toThrow(/HTML/);
    await expect(fetchJson(async () => new Response("x", { headers: { "content-type": "application/zip" } }), "https://x.test/j")).rejects.toThrow(/JSON/);
  });
  it("returns the bytes and the Last-Modified date", async () => {
    const r = await fetchBytes(async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "application/zip", "last-modified": "Thu, 02 Jul 2026 20:11:47 GMT" } }), "https://x.test/f");
    expect([...r.bytes]).toEqual([1, 2]);
    expect(r.lastModified).toBe("2026-07-02");
  });
});
