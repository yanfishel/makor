import { count, desc, eq, max, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { admitSessionUser, normalizeEmail, type AccountEmail } from "@/lib/invitations";
import { PAGE_SIZE, clampPage } from "@/lib/paging";
import { apiKeys, documents, invitations, userSettings, users, type UserRow } from "@/lib/db/schema";
import { dashboardStats, listDocuments, trialUsed, usageSummary, type DashboardStats, type DocumentMeta, type UsageSummary } from "@/lib/documents";

export type Role = "admin" | "user";

/** `last_seen_at` is rewritten at most this often — every session request calls ensureUser. */
const SEEN_REFRESH_MS = 60_000;

export function getUser(db: Db, userId: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.userId, userId)).get();
}

export function adminCount(db: Db): number {
  return db.select({ n: count() }).from(users).where(eq(users.role, "admin")).get()?.n ?? 0;
}

/**
 * Registers a session user on first sight and refreshes last_seen_at afterwards.
 * The very first user of the deployment becomes the admin — decided inside one write
 * transaction so two simultaneous first sign-ins cannot both (or neither) win.
 */
export function ensureUser(db: Db, userId: string, now: Date = new Date()): { user: UserRow; created: boolean } {
  const iso = now.toISOString();
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const existing = getUser(t, userId);
    if (existing) {
      if (new Date(existing.lastSeenAt).getTime() < now.getTime() - SEEN_REFRESH_MS) {
        t.update(users).set({ lastSeenAt: iso }).where(eq(users.userId, userId)).run();
        return { user: { ...existing, lastSeenAt: iso }, created: false };
      }
      return { user: existing, created: false };
    }
    const role: Role = adminCount(t) === 0 ? "admin" : "user";
    const row: UserRow = { userId, role, trialUnlimited: false, email: null, createdAt: iso, lastSeenAt: iso };
    t.insert(users).values(row).run();
    return { user: row, created: true };
  }, { behavior: "immediate" });
}

/** How clerk mode decides a first sight: the bootstrap admin's address and the account's addresses as Clerk reports them. */
export interface SessionAccess { adminEmail: string | null; userEmails: (userId: string) => Promise<AccountEmail[]> }

/**
 * Registers a session user. `access` null (none mode): everyone is registered, the first one
 * admin (`ensureUser`). Clerk mode: an existing row is refreshed and, while it has no e-mail,
 * looked up (a failed lookup is logged, never fatal); a first sight is admitted only by
 * `admitSessionUser` — null means not invited, and nothing was written. A failed lookup on a
 * first sight throws: there is nothing to decide with.
 */
export async function registerSessionUser(db: Db, userId: string, access: SessionAccess | null, now: Date = new Date()): Promise<UserRow | null> {
  if (access && !getUser(db, userId)) {
    return admitSessionUser(db, userId, await access.userEmails(userId), access.adminEmail, now);
  }
  const { user } = ensureUser(db, userId, now);
  if (user.email !== null || !access) return user;
  try {
    const emails = await access.userEmails(userId);
    const found = (emails.find((e) => e.verified) ?? emails[0])?.email;
    const email = found === undefined ? null : normalizeEmail(found);
    setUserEmail(db, userId, email);
    return { ...user, email };
  } catch (err) {
    console.error(`users: e-mail lookup failed for ${userId}: ${(err as Error).name}`);
    return user;
  }
}

export function setUserEmail(db: Db, userId: string, email: string | null): void {
  db.update(users).set({ email }).where(eq(users.userId, userId)).run();
}

/** The registered user with this address (compared lower-cased; the argument must already be normalized). */
export function userByEmail(db: Db, email: string): UserRow | undefined {
  return db.select().from(users).where(sql`lower(${users.email}) = ${email}`).get();
}

/**
 * Everything the app holds for a user, in one transaction: documents (stored results
 * included), API keys, settings and the row. An accepted invitation keeps its row as a record,
 * unlinked from the user. False when there was no such user.
 */
export function deleteUserData(db: Db, userId: string): boolean {
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    if (!getUser(t, userId)) return false;
    t.delete(documents).where(eq(documents.userId, userId)).run();
    t.delete(apiKeys).where(eq(apiKeys.userId, userId)).run();
    t.delete(userSettings).where(eq(userSettings.userId, userId)).run();
    t.update(invitations).set({ acceptedUserId: null }).where(eq(invitations.acceptedUserId, userId)).run();
    t.delete(users).where(eq(users.userId, userId)).run();
    return true;
  }, { behavior: "immediate" });
}

/** Admins and users flagged by an admin run trial-mode requests on the server's own key without a cap. */
export function isUnlimited(user: Pick<UserRow, "role" | "trialUnlimited"> | undefined): boolean {
  return Boolean(user && (user.role === "admin" || user.trialUnlimited));
}

export function updateUser(db: Db, userId: string, patch: { role?: Role; trialUnlimited?: boolean }): UserRow | undefined {
  if (!getUser(db, userId)) return undefined;
  if (patch.role !== undefined || patch.trialUnlimited !== undefined) db.update(users).set(patch).where(eq(users.userId, userId)).run();
  return getUser(db, userId);
}

export interface AdminUserSummary {
  userId: string;
  email: string | null;
  role: Role;
  trialUnlimited: boolean;
  unlimited: boolean;
  hasAnthropicKey: boolean;
  createdAt: string;
  lastSeenAt: string;
  docsTotal: number;
  docsOk: number;
  docsThisMonth: number;
  trialUsed: number;
  lastDocumentAt: string | null;
}

/** One page of registered users (newest sign-in first) with per-user document counts, plus the total. */
export function listUsers(db: Db, now: Date, windowMs: number, opts: { limit?: number; offset?: number } = {}): { users: AdminUserSummary[]; total: number } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = db.select().from(users).orderBy(desc(users.createdAt), desc(users.userId)).limit(limit).offset(offset).all();
  const total = db.select({ n: count() }).from(users).get()?.n ?? 0;
  return { users: summarize(db, rows, now, windowMs), total };
}

function summarize(db: Db, rows: UserRow[], now: Date, windowMs: number): AdminUserSummary[] {
  const month = now.toISOString().slice(0, 7);
  const monthStart = `${month}-01T00:00:00.000Z`;
  const agg = db.select({
    userId: documents.userId,
    total: count(),
    ok: sql<number>`sum(case when ${documents.status} = 200 then 1 else 0 end)`,
    month: sql<number>`sum(case when ${documents.createdAt} >= ${monthStart} then 1 else 0 end)`,
    last: max(documents.createdAt),
  }).from(documents).groupBy(documents.userId).all();
  const byUser = new Map(agg.map((a) => [a.userId, a]));
  const keys = new Set(db.select({ userId: userSettings.userId }).from(userSettings).where(sql`${userSettings.anthropicKeyEnc} is not null`).all().map((r) => r.userId));
  return rows.map((u) => {
    const a = byUser.get(u.userId);
    return {
      userId: u.userId, email: u.email, role: u.role as Role, trialUnlimited: u.trialUnlimited, unlimited: isUnlimited(u),
      hasAnthropicKey: keys.has(u.userId), createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
      docsTotal: a?.total ?? 0, docsOk: Number(a?.ok ?? 0), docsThisMonth: Number(a?.month ?? 0),
      trialUsed: trialUsed(db, u.userId, now, windowMs), lastDocumentAt: a?.last ?? null,
    };
  });
}

export interface AdminUserDetail extends AdminUserSummary {
  usage: UsageSummary;
  stats: DashboardStats;
  recent: DocumentMeta[];
  recentPage: number;
  recentTotal: number;
  storeResults: boolean;
  model: string | null;
}

/** One user's dashboard as the admin sees it: metadata and counts only, never a stored result. */
export function userDetail(db: Db, userId: string, now: Date, windowMs: number, opts: { page?: number; pageSize?: number } = {}): AdminUserDetail | undefined {
  const row = getUser(db, userId);
  if (!row) return undefined;
  const [summary] = summarize(db, [row], now, windowMs);
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const stats = dashboardStats(db, userId, now);
  const recentPage = clampPage(opts.page ?? 1, stats.total, pageSize);
  const recent = listDocuments(db, userId, { limit: pageSize, offset: (recentPage - 1) * pageSize });
  const settings = db.select({ storeResults: userSettings.storeResults, model: userSettings.model }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return {
    ...summary,
    usage: usageSummary(db, userId, windowMs, now),
    stats,
    recent: recent.items,
    recentPage,
    recentTotal: recent.total,
    storeResults: settings?.storeResults ?? false,
    model: settings?.model ?? null,
  };
}
