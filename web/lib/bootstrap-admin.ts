import { clerkAdmin } from "@/lib/clerk-admin";
import { getConfig } from "@/lib/config";
import { getDb, type Db } from "@/lib/db";
import { clerkErrorTag, effectiveStatus, inviteRedirectUrl, pendingInvitation, recordInvitation, type ClerkAdminPort } from "@/lib/invitations";
import { adminCount } from "@/lib/users";

export type BootstrapOutcome = "has-admin" | "already-invited" | "invited" | "no-address" | "failed";

/**
 * Invite-only registration leaves a fresh instance with nobody able to invite: while `users` holds no
 * admin, MAKOR_ADMIN_EMAIL is invited (by "system"). Idempotent — an open (unexpired pending)
 * invitation is left alone; an expired or revoked one is replaced.
 */
export async function ensureAdminInvitation(db: Db, adminEmail: string | null, port: ClerkAdminPort, siteUrl: string, now: Date = new Date()): Promise<BootstrapOutcome> {
  if (adminCount(db) > 0) return "has-admin";
  if (!adminEmail) {
    console.error("invitations: the instance has no admin and MAKOR_ADMIN_EMAIL is empty — nobody can invite anyone");
    return "no-address";
  }
  const open = pendingInvitation(db, adminEmail);
  if (open && effectiveStatus(open, now) === "pending") return "already-invited";
  try {
    const { id } = await port.createInvitation(adminEmail, inviteRedirectUrl(siteUrl));
    recordInvitation(db, { clerkInvitationId: id, email: adminEmail, invitedBy: "system" }, now);
    return "invited";
  } catch (err) {
    console.error(`invitations: the admin invitation failed (${clerkErrorTag(err)})`);
    return "failed";
  }
}

/** Server start in clerk mode (instrumentation.ts). Never throws: a bad start must not take the app down. */
export async function startupAdminInvitation(): Promise<void> {
  try {
    const cfg = getConfig();
    if (cfg.authMode !== "clerk" || !cfg.clerkSecretKey) return;
    await ensureAdminInvitation(getDb(), cfg.adminEmail, clerkAdmin(cfg.clerkSecretKey), cfg.siteUrl);
  } catch (err) {
    console.error(`invitations: startup check failed (${clerkErrorTag(err)})`);
  }
}
