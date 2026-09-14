import { describe, expect, it } from "vitest";
import { apiError, json, readJson } from "@/lib/http";

describe("http helpers", () => {
  it("json sets status and content-type", async () => {
    const r = json(201, { ok: true }, { "x-extra": "1" });
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("x-extra")).toBe("1");
    expect(await r.json()).toEqual({ ok: true });
  });
  it("apiError shapes the body", async () => {
    const r = apiError(402, "TRIAL_EXHAUSTED", "Add a key", { trial_docs: 5 });
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "TRIAL_EXHAUSTED", detail: "Add a key", trial_docs: 5 });
  });
  it("readJson returns null on garbage", async () => {
    const bad = new Request("http://x", { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
    expect(await readJson(bad)).toBeNull();
    const good = new Request("http://x", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } });
    expect(await readJson(good)).toEqual({ a: 1 });
  });
});
