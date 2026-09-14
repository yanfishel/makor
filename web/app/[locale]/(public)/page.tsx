import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { redirect } from "@/i18n/routing";
import { AuthModalOpener } from "@/components/AuthModalOpener";
import { LandingPage } from "@/components/landing/LandingPage";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return pageMetadata({ locale, path: "/", title: t("title"), description: t("description"), ogAlt: t("ogAlt"), absoluteTitle: true });
}

/** The front door: the app for the local user and a signed-in session, the landing for everyone else. `/about` shows the landing to all. */
export default async function Home({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (getConfig().authMode === "none") redirect({ href: "/app", locale });
  const { clerkSessionUserId } = await import("@/lib/clerk-session");
  if (await clerkSessionUserId()) redirect({ href: "/app", locale });
  const signIn = (await searchParams)["sign-in"] === "1";
  return (
    <>
      {signIn && <AuthModalOpener />}
      <LandingPage locale={locale} />
    </>
  );
}
