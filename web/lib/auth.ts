import { eq } from "drizzle-orm";
import { getConfig, type AuthMode } from "@/lib/config";
import { getDb, type Db } from "@/lib/db";
import { apiKeys, users } from "@/lib/db/schema";
import { hashApiKey, isApiKeyToken } from "@/lib/api-keys";
import type { AccountEmail } from "@/lib/invitations";
import { registerSessionUser } from "@/lib/users";

export type Principal = { userId: string; apiKeyId: string | null; via: "session" | "api" };

export type AuthCode = "TOKEN_INVALID" | "UNAUTHENTICATED" | "INVITE_REQUIRED";

export class AuthError extends Error {
  /** 401 when the caller is unknown; 403 for a signed-in account the app does not admit. */
  readonly status: 401 | 403;
  constructor(readonly code: AuthCode, message: string) {
    super(message);
    this.status = code === "INVITE_REQUIRED" ? 403 : 401;
  }
}

/** Who is calling. Bearer ak_ keys first (they work in every mode), then the mode's session. */
export async function getPrincipal(
  request: Request,
  deps: { db?: Db; authMode?: AuthMode; sessionUserId?: () => Promise<string | null>; userEmails?: (id: string) => Promise<AccountEmail[]>; adminEmail?: string | null; now?: () => Date } = {},
): Promise<Principal> {
  const authMode = deps.authMode ?? getConfig().authMode;
  const header = request.headers.get("authorization");
  if (header) {
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (!isApiKeyToken(token)) throw new AuthError("TOKEN_INVALID", "Malformed API key");
    const db = deps.db ?? getDb();
    // Inner join `users`: a key survives its owner's row (deleteUserData removes the key too,
    // but a stray key must still never resolve to a user who no longer exists).
    const row = db.select({ id: apiKeys.id, userId: apiKeys.userId, revokedAt: apiKeys.revokedAt })
      .from(apiKeys).innerJoin(users, eq(users.userId, apiKeys.userId)).where(eq(apiKeys.hash, hashApiKey(token))).get();
    if (!row || row.revokedAt) throw new AuthError("TOKEN_INVALID", "Unknown or revoked API key");
    db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, row.id)).run();
    return { userId: row.userId, apiKeyId: row.id, via: "api" };
  }
  const now = (deps.now ?? (() => new Date()))();
  if (authMode === "none") {
    await registerSessionUser(deps.db ?? getDb(), "local", null, now);
    return { userId: "local", apiKeyId: null, via: "session" };
  }
  // Dynamic import: @clerk/nextjs/server never enters the none-mode or test import graph.
  let lookup = deps.sessionUserId;
  let userEmails = deps.userEmails ?? null;
  if (!lookup) {
    const clerk = await import("@/lib/clerk-session");
    lookup = clerk.clerkSessionUserId;
    userEmails ??= clerk.clerkUserEmails;
  }
  const userId = await lookup();
  if (!userId) throw new AuthError("UNAUTHENTICATED", "Sign in required");
  const access = { adminEmail: deps.adminEmail !== undefined ? deps.adminEmail : getConfig().adminEmail, userEmails: userEmails ?? (async () => []) };
  if (!(await registerSessionUser(deps.db ?? getDb(), userId, access, now))) throw new AuthError("INVITE_REQUIRED", "Makor accounts are by invitation");
  return { userId, apiKeyId: null, via: "session" };
}
