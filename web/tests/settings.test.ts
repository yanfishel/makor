import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { clearAnthropicKey, getSettings, isAllowedCloudModel, publicSettings, setAnthropicKey, updateSettings, verifyAnthropicKey } from "@/lib/settings";

const db = () => openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-st-")), "t.sqlite3"));

describe("settings", () => {
  it("upserts and reads back", () => {
    const d = db();
    expect(updateSettings(d, "u1", { storeResults: true })).toMatchObject({ storeResults: true, model: null });
    expect(updateSettings(d, "u1", { model: "claude-sonnet-5" })).toMatchObject({ storeResults: true, model: "claude-sonnet-5" });
    setAnthropicKey(d, "u1", "enc", "nt-x");
    expect(getSettings(d, "u1")).toMatchObject({ anthropicKeyEnc: "enc", anthropicKeyLast4: "nt-x", storeResults: true });
    clearAnthropicKey(d, "u1");
    expect(getSettings(d, "u1")).toMatchObject({ anthropicKeyEnc: null, anthropicKeyLast4: null });
  });
  it("publicSettings never exposes the key", () => {
    const d = db();
    setAnthropicKey(d, "u1", "enc", "nt-x");
    const p = publicSettings(getSettings(d, "u1"), "clerk");
    expect(p).toMatchObject({ has_anthropic_key: true, anthropic_key_last4: "nt-x", default_model: "claude-opus-5" });
    expect(JSON.stringify(p)).not.toContain("enc");
    expect(p.model_choices.find((m) => m.recommended)?.id).toBe("claude-opus-5");
  });
  it("keeps the local model beside the cloud model", () => {
    const d = db();
    expect(updateSettings(d, "u1", { localModel: "qwen3-vl:30b-a3b-instruct" })).toMatchObject({ localModel: "qwen3-vl:30b-a3b-instruct", model: null });
    expect(updateSettings(d, "u1", { model: "claude-sonnet-5" })).toMatchObject({ localModel: "qwen3-vl:30b-a3b-instruct", model: "claude-sonnet-5" });
    expect(publicSettings(getSettings(d, "u1"), "none")).toMatchObject({ local_model: "qwen3-vl:30b-a3b-instruct", model: "claude-sonnet-5" });
    expect(updateSettings(d, "u1", { localModel: null }).localModel).toBeNull();
  });
  it("model allow-list", () => {
    expect(isAllowedCloudModel("claude-opus-5")).toBe(true);
    expect(isAllowedCloudModel("claude-opus-4-1")).toBe(false);
  });
  it("verifyAnthropicKey maps HTTP outcomes", async () => {
    const mk = (status: number) => vi.fn(async () => new Response("{}", { status })) as unknown as typeof fetch;
    expect(await verifyAnthropicKey("sk-ant-x", mk(200))).toBe("valid");
    expect(await verifyAnthropicKey("sk-ant-x", mk(401))).toBe("invalid");
    expect(await verifyAnthropicKey("sk-ant-x", mk(500))).toBe("unreachable");
    const boom = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await verifyAnthropicKey("sk-ant-x", boom)).toBe("unreachable");
    const f = mk(200);
    await verifyAnthropicKey("sk-ant-x", f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-x");
  });
});

describe("checkRegistries", () => {
  it("defaults off, survives an unrelated update, and is public as check_registries", () => {
    const d = db();
    expect(getSettings(d, "u").checkRegistries).toBe(false);
    updateSettings(d, "u", { checkRegistries: true });
    updateSettings(d, "u", { storeResults: true });
    const row = getSettings(d, "u");
    expect(row.checkRegistries).toBe(true);
    expect(publicSettings(row, "none").check_registries).toBe(true);
  });
});
