import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { LandingPage } from "@/components/landing/LandingPage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return pageMetadata({ locale, path: "/about", title: t("title"), description: t("description"), ogAlt: t("ogAlt"), absoluteTitle: true, canonicalPath: "/" });
}

/** The landing without the front door's redirect: the user menu's About, for a signed-in session and the local build. */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LandingPage locale={locale} />;
}
