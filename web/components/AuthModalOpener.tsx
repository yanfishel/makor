"use client";
import { useClerk } from "@clerk/nextjs";
import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

/**
 * Rendered by the landing when the URL carries `?sign-in=1` (the header link, the footer and
 * middleware's signInUrl point there): opens Clerk's sign-in modal and strips the query so a
 * refresh or a dismissed modal does not reopen it. There is no open-registration modal —
 * registering is by invitation, through /invite. The modal lives on the Clerk singleton, so the
 * re-render that unmounts this component leaves it open.
 */
export function AuthModalOpener() {
  const clerk = useClerk();
  const router = useRouter();
  useEffect(() => {
    clerk.openSignIn();
    router.replace("/", { scroll: false });
  }, [clerk, router]);
  return null;
}
