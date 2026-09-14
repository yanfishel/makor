import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decrypt, encrypt, loadMasterKey } from "@/lib/crypto";

const key = randomBytes(32);

describe("encrypt/decrypt", () => {
  it("round-trips unicode", () => {
    const c = encrypt('{"first_name_he":"ישראל"}', key);
    expect(c.startsWith("v1:")).toBe(true);
    expect(decrypt(c, key)).toBe('{"first_name_he":"ישראל"}');
  });
  it("uses a fresh IV each time", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });
  it("rejects tampering and a wrong key", () => {
    const c = encrypt("secret", key);
    const [v, iv, tag, data] = c.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow(/invalid/);
    expect(() => decrypt(c, randomBytes(32))).toThrow(/invalid/);
    expect(() => decrypt("v2:a:b:c", key)).toThrow(/invalid/);
  });
});

describe("loadMasterKey", () => {
  it("uses the env key when set", () => {
    const b64 = key.toString("base64");
    expect(loadMasterKey({ authMode: "clerk", masterKeyB64: b64, dataDir: "/nonexistent" }).equals(key)).toBe(true);
  });
  it("rejects an env key of the wrong length", () => {
    expect(() => loadMasterKey({ authMode: "none", masterKeyB64: Buffer.alloc(16).toString("base64"), dataDir: "/x" })).toThrow(/32 bytes/);
  });
  it("generates and persists a key in none mode", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "makor-"));
    const k1 = loadMasterKey({ authMode: "none", masterKeyB64: null, dataDir: dir });
    const k2 = loadMasterKey({ authMode: "none", masterKeyB64: null, dataDir: dir });
    expect(k1.length).toBe(32);
    expect(k1.equals(k2)).toBe(true);
    const file = path.join(dir, "master.key");
    expect(Buffer.from(readFileSync(file, "utf8").trim(), "base64").equals(k1)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it("refuses to generate in clerk mode", () => {
    expect(() => loadMasterKey({ authMode: "clerk", masterKeyB64: null, dataDir: "/x" })).toThrow(/MAKOR_MASTER_KEY/);
  });
});
