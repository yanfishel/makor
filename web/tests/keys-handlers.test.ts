import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { createApiKey } from "@/lib/api-keys";
import type { Principal } from "@/lib/auth";
import type { ReadDeps } from "@/lib/usage-handlers";
import { handleCreateKey, handleListKeys, handleRevokeKey } from "@/lib/keys-handlers";

const session: Principal = { userId: "local", apiKeyId: null, via: "session" };
const viaKey: Principal = { userId: "local", apiKeyId: "k", via: "api" };
function setup(principal: Principal = session) {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "makor-kh-")), "t.sqlite3"));
  const deps: ReadDeps = { db, masterKey: randomBytes(32), principal: async () => principal, config: getConfig({ AUTH_MODE: "none", DATA_DIR: "/x" }) };
  return { db, deps };
}
const post = (body: unknown) => new Request("http://x/api/keys", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("keys handlers", () => {
  it("creates, lists and revokes", async () => {
    const { deps } = setup();
    const created = await handleCreateKey(post({ name: "ci" }), deps);
    expect(created.status).toBe(201);
    const { token, key } = await created.json();
    expect(token.startsWith("ak_")).toBe(true);
    const list = await (await handleListKeys(new Request("http://x/api/keys"), deps)).json();
    expect(list.keys).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(token);
    expect((await handleRevokeKey(new Request("http://x", { method: "DELETE" }), key.id, deps)).status).toBe(204);
    expect((await handleRevokeKey(new Request("http://x", { method: "DELETE" }), key.id, deps)).status).toBe(404);
  });
  it("rejects bad names and enforces the active-key limit", async () => {
    const { db, deps } = setup();
    expect((await handleCreateKey(post({ name: "" }), deps)).status).toBe(400);
    expect((await handleCreateKey(post({}), deps)).status).toBe(400);
    expect((await handleCreateKey(new Request("http://x", { method: "POST", body: "nope" }), deps)).status).toBe(400);
    for (let i = 0; i < 20; i++) createApiKey(db, "local", `k${i}`);
    expect((await handleCreateKey(post({ name: "one more" }), deps)).status).toBe(409);
  });
  it("is session-only", async () => {
    const { deps } = setup(viaKey);
    const res = await handleListKeys(new Request("http://x/api/keys"), deps);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("SESSION_REQUIRED");
  });
});
