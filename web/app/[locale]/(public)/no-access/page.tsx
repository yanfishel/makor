import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/Container";
import { SignOutAction } from "@/components/SignOutAction";
import { Button } from "@/components/ui/button";
import { redirect } from "@/i18n/routing";
import { getConfig } from "@/lib/config";
import { NOINDEX } from "@/lib/seo";
import { getDb } from "@/lib/db";
import { REQUEST_ACCESS_SUBJECT, mailtoHref } from "@/lib/links";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata = NOINDEX;

/** Where `currentUser` sends a signed-in Clerk account the access check did not admit. */
export default async function NoAccessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (getConfig().authMode !== "clerk") notFound();
  const clerk = await import("@/lib/clerk-session");
  const userId = await clerk.clerkSessionUserId();
  if (!userId) return redirect({ href: "/", locale });
  if (getUser(getDb(), userId)) return redirect({ href: "/app", locale });
  const emails = await clerk.clerkUserEmails(userId).catch(() => []);
  const email = emails.find((e) => e.verified)?.email ?? emails[0]?.email ?? null;
  const t = await getTranslations({ locale, namespace: "access" });
  return (
    <Container className="max-w-xl space-y-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t("noAccessTitle")}</h1>
      <p className="text-muted-foreground">
        {email ? t.rich("noAccessBody", { email, addr: (chunks) => <bdi dir="ltr" lang="en">{chunks}</bdi> }) : t("noAccessBodyUnknown")}
      </p>
      <p className="text-sm text-muted-foreground">{t("noAccessHint")}</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="highlight"><a href={mailtoHref(REQUEST_ACCESS_SUBJECT)}>{t("requestAccess")}</a></Button>
        <SignOutAction label={t("signOut")} />
      </div>
    </Container>
  );
}
