import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/routing";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { isUnlimited, registerSessionUser, type Role } from "@/lib/users";

export interface CurrentUser { userId: string; role: Role; unlimited: boolean; email: string | null }

/**
 * The signed-in user for a server-rendered page. Middleware already redirected anonymous
 * visitors; an account the access check refuses is sent to /no-access — a redirect, because a
 * layout and its page render concurrently and a thrown error loses its class in production.
 */
export async function currentUser(): Promise<CurrentUser> {
  const cfg = getConfig();
  if (cfg.authMode === "none") {
    const user = (await registerSessionUser(getDb(), "local", null))!;
    return { userId: "local", role: user.role as Role, unlimited: isUnlimited(user), email: null };
  }
  const clerk = await import("@/lib/clerk-session");
  const userId = await clerk.clerkSessionUserId();
  if (!userId) throw new Error("no session on a protected page");
  const user = await registerSessionUser(getDb(), userId, { adminEmail: cfg.adminEmail, userEmails: clerk.clerkUserEmails });
  if (!user) return redirect({ href: "/no-access", locale: await getLocale() });
  return { userId, role: user.role as Role, unlimited: isUnlimited(user), email: user.email };
}

export async function currentUserId(): Promise<string> {
  return (await currentUser()).userId;
}
