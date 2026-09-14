import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { createApiKey, generateApiKey, hashApiKey, isApiKeyToken, listApiKeys, revokeApiKey } from "@/lib/api-keys";
import { getPrincipal } from "@/lib/auth";
import { ensureUser } from "@/lib/users";

const db = () => openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-keys-")), "t.sqlite3"));

describe("generateApiKey", () => {
  it("makes a valid, unique token whose prefix and hash match", () => {
    const a = generateApiKey(), b = generateApiKey();
    expect(isApiKeyToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.prefix).toBe(a.token.slice(0, 8));
    expect(a.hash).toBe(hashApiKey(a.token));
    expect(a.token.length).toBe(3 + 43);
  });
});

describe("create/list/revoke", () => {
  it("round-trips through getPrincipal and never stores the token", async () => {
    const d = db();
    ensureUser(d, "u1", new Date("2026-09-06T00:00:00Z"));
    const { token, key } = createApiKey(d, "u1", "ci", new Date("2026-09-06T00:00:00Z"));
    expect(key).toMatchObject({ name: "ci", prefix: token.slice(0, 8), revokedAt: null, lastUsedAt: null });
    const raw = d.$client.prepare("select * from api_keys").all() as Record<string, unknown>[];
    expect(JSON.stringify(raw)).not.toContain(token);
    const req = new Request("http://x", { headers: { authorization: `Bearer ${token}` } });
    await expect(getPrincipal(req, { db: d, authMode: "none" })).resolves.toMatchObject({ userId: "u1", apiKeyId: key.id, via: "api" });
    expect(listApiKeys(d, "u1")[0].lastUsedAt).not.toBeNull();
  });
  it("revoke is owner-scoped and idempotent, list is newest first", () => {
    const d = db();
    const a = createApiKey(d, "u1", "a", new Date("2026-09-01T00:00:00Z")).key;
    const b = createApiKey(d, "u1", "b", new Date("2026-09-02T00:00:00Z")).key;
    expect(listApiKeys(d, "u1").map((k) => k.id)).toEqual([b.id, a.id]);
    expect(revokeApiKey(d, "u2", a.id)).toBe(false);
    expect(revokeApiKey(d, "u1", a.id)).toBe(true);
    expect(revokeApiKey(d, "u1", a.id)).toBe(false);
    expect(listApiKeys(d, "u1").find((k) => k.id === a.id)?.revokedAt).not.toBeNull();
  });
});
