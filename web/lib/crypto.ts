import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** AES-256-GCM. Output "v1:<iv>:<tag>:<data>", all base64, so the scheme can change later. */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("ciphertext invalid");
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("ciphertext invalid");
  }
}

export function loadMasterKey(cfg: { authMode: "clerk" | "none"; masterKeyB64: string | null; dataDir: string }): Buffer {
  if (cfg.masterKeyB64) {
    const key = Buffer.from(cfg.masterKeyB64, "base64");
    if (key.length !== KEY_BYTES) throw new Error(`MAKOR_MASTER_KEY must decode to ${KEY_BYTES} bytes`);
    return key;
  }
  if (cfg.authMode !== "none") throw new Error("MAKOR_MASTER_KEY is required outside AUTH_MODE=none");
  const file = path.join(cfg.dataDir, "master.key");
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
    if (key.length !== KEY_BYTES) throw new Error(`${file} must hold ${KEY_BYTES} base64 bytes`);
    return key;
  }
  mkdirSync(cfg.dataDir, { recursive: true });
  const key = randomBytes(KEY_BYTES);
  writeFileSync(file, key.toString("base64") + "\n", { mode: 0o600, flag: "wx" });
  return key;
}

const g = globalThis as unknown as { __makorMasterKey?: Buffer };

/** The process-wide master key: loaded (or generated, none mode) once, then reused. */
export function getMasterKey(): Buffer {
  if (!g.__makorMasterKey) g.__makorMasterKey = loadMasterKey(getConfig());
  return g.__makorMasterKey;
}
