import { SignUp } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/Container";
import { redirect } from "@/i18n/routing";
import { getConfig } from "@/lib/config";
import { NOINDEX } from "@/lib/seo";
import { localePath } from "@/lib/links";

export const dynamic = "force-dynamic";
export const metadata = NOINDEX;

/**
 * The invitation e-mail's link lands here with `__clerk_ticket`. Clerk's <SignUp /> is
 * rendered inline because it consumes the ticket from the URL; the modal is opened after
 * AuthModalOpener strips the query string, so it would lose it.
 */
export default async function InvitePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (getConfig().authMode !== "clerk") notFound();
  const { clerkSessionUserId } = await import("@/lib/clerk-session");
  if (await clerkSessionUserId()) return redirect({ href: "/app", locale });
  const t = await getTranslations({ locale, namespace: "access" });
  return (
    <Container className="flex flex-col items-center gap-6 py-12">
      <div className="max-w-md space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("inviteTitle")}</h1>
        <p className="text-muted-foreground">{t("inviteLead")}</p>
      </div>
      <SignUp routing="hash" forceRedirectUrl="/app" signInUrl="/?sign-in=1" />
      <p className="max-w-md text-center text-xs text-muted-foreground">
        {t.rich("inviteConsent", {
          terms: (chunks) => <a href={localePath(locale, "/terms")} className="text-highlight hover:underline">{chunks}</a>,
          privacy: (chunks) => <a href={localePath(locale, "/privacy")} className="text-highlight hover:underline">{chunks}</a>,
        })}
      </p>
    </Container>
  );
}
