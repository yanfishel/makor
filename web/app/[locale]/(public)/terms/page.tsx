import { getMessages, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Container } from "@/components/Container";
import { LegalPage, type LegalMessages } from "@/components/LegalPage";
import { SiteFooter } from "@/components/public/SiteFooter";
import type { SignatureLabels } from "@/components/Signature";
import type en from "@/messages/en.json";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return pageMetadata({ locale, path: "/terms", title: t("terms.title"), description: t("terms.description"), ogAlt: t("ogAlt") });
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const messages = await getMessages();
  const m = messages.legal as LegalMessages;
  const footer = (messages.landing as (typeof en)["landing"]).footer;
  return <><Container><LegalPage doc={m.terms} m={m} locale={locale} /></Container><SiteFooter locale={locale} path="/terms" labels={footer} signature={messages.signature as SignatureLabels} /></>;
}
