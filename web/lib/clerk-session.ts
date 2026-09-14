import { auth, clerkClient } from "@clerk/nextjs/server";
import type { AccountEmail } from "@/lib/invitations";

/** userId of the signed-in Clerk session for the current request, or null. */
export async function clerkSessionUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/** Every address of a Clerk user with whether Clerk verified it — the access check counts verified ones only. */
export async function clerkUserEmails(userId: string): Promise<AccountEmail[]> {
  const user = await (await clerkClient()).users.getUser(userId);
  return user.emailAddresses.map((e) => ({ email: e.emailAddress, verified: e.verification?.status === "verified" }));
}
