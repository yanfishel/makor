import type { ClerkAdminPort } from "@/lib/invitations";

/** A Clerk API error whose status says the object is already gone or closed. */
async function isGone(err: unknown, statuses: number[]): Promise<boolean> {
  const { isClerkAPIResponseError } = await import("@clerk/nextjs/errors");
  return isClerkAPIResponseError(err) && statuses.includes(err.status);
}

/** The Backend API behind ClerkAdminPort. Imported lazily so none mode and tests never load Clerk. */
export function clerkAdmin(secretKey: string): ClerkAdminPort {
  const client = async () => (await import("@clerk/nextjs/server")).createClerkClient({ secretKey });
  return {
    async createInvitation(email, redirectUrl) {
      const invitation = await (await client()).invitations.createInvitation({ emailAddress: email, redirectUrl, notify: true, ignoreExisting: true });
      return { id: invitation.id };
    },
    async revokeInvitation(id) {
      try { await (await client()).invitations.revokeInvitation(id); }
      catch (err) { if (!(await isGone(err, [400, 404, 422]))) throw err; }
    },
    async deleteUser(userId) {
      try { await (await client()).users.deleteUser(userId); }
      catch (err) { if (!(await isGone(err, [404]))) throw err; }
    },
  };
}
