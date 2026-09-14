import { createHash, randomBytes, randomUUID } from "node:crypto";
import { desc, eq, and, isNull, count } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";

export const API_KEY_RE = /^ak_[A-Za-z0-9_-]{32,}$/;

export function isApiKeyToken(token: string): boolean {
  return API_KEY_RE.test(token);
}

/** Keys are stored hashed; the plain token is shown once at creation (plan 2). */
export function hashApiKey(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateApiKey(): { token: string; prefix: string; hash: string } {
  const token = "ak_" + randomBytes(32).toString("base64url");
  return { token, prefix: token.slice(0, 8), hash: hashApiKey(token) };
}

export interface ApiKeyMeta { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
const META = { id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt };

export function createApiKey(db: Db, userId: string, name: string, now: Date = new Date()): { token: string; key: ApiKeyMeta } {
  const { token, prefix, hash } = generateApiKey();
  const key: ApiKeyMeta = { id: randomUUID(), name, prefix, createdAt: now.toISOString(), lastUsedAt: null, revokedAt: null };
  db.insert(apiKeys).values({ ...key, userId, hash }).run();
  return { token, key };
}

export function listApiKeys(db: Db, userId: string): ApiKeyMeta[] {
  return db.select(META).from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.createdAt), desc(apiKeys.id)).all();
}

export function activeKeyCount(db: Db, userId: string): number {
  return db.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt))).get()?.n ?? 0;
}

export function revokeApiKey(db: Db, userId: string, id: string, now: Date = new Date()): boolean {
  return db.update(apiKeys).set({ revokedAt: now.toISOString() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt))).run().changes > 0;
}
