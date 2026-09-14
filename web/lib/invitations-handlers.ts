import type { Principal } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-handlers";
import { apiError, json, readJson } from "@/lib/http";
import {
  clerkErrorTag, effectiveStatus, getInvitation, inviteRedirectUrl, isValidEmail, listInvitations, markResent, markRevoked,
  normalizeEmail, pendingInvitation, recordInvitation, type ClerkAdminPort,
} from "@/lib/invitations";
import type { ReadDeps } from "@/lib/usage-handlers";
import { userByEmail } from "@/lib/users";

const now = (d: ReadDeps) => (d.now ?? (() => new Date()))();

/** Clerk mode only (none mode has one implicit user and nobody to invite), then an admin session. */
function withInvitations(request: Request, deps: ReadDeps, fn: (port: ClerkAdminPort, p: Principal) => Promise<Response> | Response): Promise<Response> {
  const port = deps.config.authMode === "clerk" ? deps.clerkAdmin : undefined;
  if (!port) return Promise.resolve(apiError(404, "NOT_FOUND"));
  return requireAdmin(request, deps, (p) => fn(port, p));
}

export const handleListInvitations = (request: Request, deps: ReadDeps) =>
  withInvitations(request, deps, () => json(200, { invitations: listInvitations(deps.db, now(deps)) }));

/** POST { email } — Clerk e-mails the link first; the row is written only once Clerk accepted. */
export const handleCreateInvitation = (request: Request, deps: ReadDeps) => withInvitations(request, deps, async (port, p) => {
  const body = await readJson<{ email?: unknown }>(request);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  if (!isValidEmail(email)) return apiError(400, "EMAIL_INVALID", "Not an e-mail address");
  if (userByEmail(deps.db, email)) return apiError(409, "ALREADY_REGISTERED", "This address already has an account");
  const at = now(deps);
  const open = pendingInvitation(deps.db, email);
  if (open && effectiveStatus(open, at) === "pending") return apiError(409, "ALREADY_INVITED", "An invitation is pending — resend it");
  let clerkInvitationId: string;
  try {
    clerkInvitationId = (await port.createInvitation(email, inviteRedirectUrl(deps.config.siteUrl))).id;
  } catch (err) {
    console.error(`invitations: Clerk refused an invitation (${clerkErrorTag(err)})`);
    return apiError(502, "INVITE_SEND_FAILED", "Clerk did not send the invitation");
  }
  return json(201, { id: recordInvitation(deps.db, { clerkInvitationId, email, invitedBy: p.userId }, at).id });
});

/**
 * POST — a pending invitation (expired or not) is sent anew, then the old Clerk invitation is
 * revoked. Create first: only its failure means nothing changed for the address, so only it
 * answers 502 with the row untouched. A revoke failure after a successful create is merely
 * logged — the address already has a working invitation link, and the row still moves to it.
 */
export const handleResendInvitation = (request: Request, id: string, deps: ReadDeps) => withInvitations(request, deps, async (port) => {
  const row = getInvitation(deps.db, id);
  if (!row) return apiError(404, "NOT_FOUND");
  if (row.status !== "pending") return apiError(409, "INVITATION_CLOSED", "Accepted or revoked");
  let clerkInvitationId: string;
  try {
    clerkInvitationId = (await port.createInvitation(row.email, inviteRedirectUrl(deps.config.siteUrl))).id;
  } catch (err) {
    console.error(`invitations: resend ${id} failed (${clerkErrorTag(err)})`);
    return apiError(502, "INVITE_SEND_FAILED", "Clerk did not send the invitation");
  }
  try {
    await port.revokeInvitation(row.clerkInvitationId);
  } catch (err) {
    console.error(`invitations: resend ${id} could not revoke the old invitation (${clerkErrorTag(err)})`);
  }
  markResent(deps.db, id, clerkInvitationId, now(deps));
  return json(200, { id });
});

/** DELETE — revoked in Clerk first; the row closes only once Clerk agreed. */
export const handleRevokeInvitation = (request: Request, id: string, deps: ReadDeps) => withInvitations(request, deps, async (port) => {
  const row = getInvitation(deps.db, id);
  if (!row) return apiError(404, "NOT_FOUND");
  if (row.status !== "pending") return apiError(409, "INVITATION_CLOSED", "Accepted or revoked");
  try {
    await port.revokeInvitation(row.clerkInvitationId);
  } catch (err) {
    console.error(`invitations: revoke ${id} failed (${clerkErrorTag(err)})`);
    return apiError(502, "INVITE_REVOKE_FAILED", "Clerk did not revoke the invitation");
  }
  markRevoked(deps.db, id);
  return new Response(null, { status: 204 });
});
