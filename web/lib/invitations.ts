import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/lib/db";
import { invitations, users, type InvitationRow, type UserRow } from "@/lib/db/schema";

/** Clerk's invitations expire after 30 days; the row mirrors it so the access check refuses a stale one on its own. */
export const INVITATION_TTL_DAYS = 30;

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

/** One address of a Clerk account, as Clerk reports it — only verified ones admit anybody. */
export interface AccountEmail { email: string; verified: boolean }

/** What the admin routes and the bootstrap need from Clerk; tests pass a fake. */
export interface ClerkAdminPort {
  createInvitation(email: string, redirectUrl: string): Promise<{ id: string }>;
  /** An invitation Clerk already closed (revoked, accepted, expired) is not an error. */
  revokeInvitation(clerkInvitationId: string): Promise<void>;
  /** An account Clerk no longer has is not an error. */
  deleteUser(userId: string): Promise<void>;
}

export interface InvitationView {
  id: string; email: string; invitedBy: string; invitedByEmail: string | null;
  createdAt: string; expiresAt: string; status: InvitationStatus; acceptedAt: string | null;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Deliberately loose — one @, a dot in the domain, no spaces, ≤ 254 chars; Clerk validates for real. */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Where the e-mailed link lands: the page that renders Clerk's <SignUp /> and consumes the ticket. */
export function inviteRedirectUrl(siteUrl: string): string {
  return `${siteUrl}/invite`;
}

/** A log-safe description of a Clerk failure: status and error code only — Clerk's messages can quote the address. */
export function clerkErrorTag(err: unknown): string {
  const e = err as { status?: number; errors?: { code?: string }[]; name?: string };
  return `${e?.status ?? "?"} ${e?.errors?.[0]?.code ?? e?.name ?? "Error"}`;
}

export function effectiveStatus(row: Pick<InvitationRow, "status" | "expiresAt">, now: Date): InvitationStatus {
  return row.status === "pending" && row.expiresAt <= now.toISOString() ? "expired" : (row.status as InvitationStatus);
}

const expiry = (now: Date) => new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000).toISOString();

export function getInvitation(db: Db, id: string): InvitationRow | undefined {
  return db.select().from(invitations).where(eq(invitations.id, id)).get();
}

/** The open row for an address, expired or not. */
export function pendingInvitation(db: Db, email: string): InvitationRow | undefined {
  return db.select().from(invitations).where(and(eq(invitations.email, email), eq(invitations.status, "pending"))).get();
}

/** A new pending row; an older pending row for the address (the caller has ruled out an unexpired one) is closed first. */
export function recordInvitation(db: Db, v: { clerkInvitationId: string; email: string; invitedBy: string }, now: Date): InvitationRow {
  const row: InvitationRow = {
    id: randomUUID(), clerkInvitationId: v.clerkInvitationId, email: v.email, invitedBy: v.invitedBy,
    createdAt: now.toISOString(), expiresAt: expiry(now), status: "pending", acceptedUserId: null, acceptedAt: null,
  };
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    t.update(invitations).set({ status: "revoked" }).where(and(eq(invitations.email, v.email), eq(invitations.status, "pending"))).run();
    t.insert(invitations).values(row).run();
  }, { behavior: "immediate" });
  return row;
}

export function markResent(db: Db, id: string, clerkInvitationId: string, now: Date): void {
  db.update(invitations).set({ clerkInvitationId, createdAt: now.toISOString(), expiresAt: expiry(now) }).where(eq(invitations.id, id)).run();
}

export function markRevoked(db: Db, id: string): void {
  db.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, id)).run();
}

export function listInvitations(db: Db, now: Date): InvitationView[] {
  const inviter = alias(users, "inviter");
  return db.select({ row: invitations, invitedByEmail: inviter.email }).from(invitations)
    .leftJoin(inviter, eq(inviter.userId, invitations.invitedBy))
    .orderBy(desc(invitations.createdAt), desc(invitations.id)).all()
    .map(({ row, invitedByEmail }) => ({
      id: row.id, email: row.email, invitedBy: row.invitedBy, invitedByEmail: invitedByEmail ?? null,
      createdAt: row.createdAt, expiresAt: row.expiresAt, status: effectiveStatus(row, now), acceptedAt: row.acceptedAt,
    }));
}

/**
 * First sight of a clerk-mode session user who has no `users` row. Admitted when a VERIFIED
 * address is the bootstrap admin's AND the instance still has no admin (→ admin) or has a
 * pending, unexpired invitation (→ user); the row and the invitation's acceptance are one
 * immediate transaction. Null = not invited, and nothing was written. Deliberately does not
 * import `lib/users.ts` (which imports this module) — the admin count is its own query.
 */
export function admitSessionUser(db: Db, userId: string, emails: AccountEmail[], adminEmail: string | null, now: Date): UserRow | null {
  const addresses = [...new Set(emails.filter((e) => e.verified).map((e) => normalizeEmail(e.email)))];
  if (addresses.length === 0) return null;
  const iso = now.toISOString();
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const existing = t.select().from(users).where(eq(users.userId, userId)).get();
    if (existing) return existing;
    const noAdminYet = (t.select({ n: count() }).from(users).where(eq(users.role, "admin")).get()?.n ?? 0) === 0;
    const asAdmin = adminEmail !== null && addresses.includes(adminEmail) && noAdminYet;
    const invite = t.select().from(invitations)
      .where(and(inArray(invitations.email, addresses), eq(invitations.status, "pending"), gt(invitations.expiresAt, iso)))
      .orderBy(desc(invitations.createdAt)).get();
    if (!asAdmin && !invite) return null;
    const email = asAdmin ? adminEmail : invite!.email;
    const row: UserRow = { userId, role: asAdmin ? "admin" : "user", trialUnlimited: false, email, createdAt: iso, lastSeenAt: iso };
    t.insert(users).values(row).run();
    // The bootstrap admin accepts their own invitation when there is one; an invited user accepts the one that let them in.
    const accepted = asAdmin ? t.select().from(invitations).where(and(eq(invitations.email, adminEmail), eq(invitations.status, "pending"))).get() : invite;
    if (accepted) t.update(invitations).set({ status: "accepted", acceptedUserId: userId, acceptedAt: iso }).where(eq(invitations.id, accepted.id)).run();
    return row;
  }, { behavior: "immediate" });
}
