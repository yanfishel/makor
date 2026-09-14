import { getMessages, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { ApiDocs, type DocsMessages } from "@/components/ApiDocs";
import { Container } from "@/components/Container";
import { SiteFooter } from "@/components/public/SiteFooter";
import type { SignatureLabels } from "@/components/Signature";
import { getConfig } from "@/lib/config";
import type en from "@/messages/en.json";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return pageMetadata({ locale, path: "/api-reference", title: t("apiReference.title"), description: t("apiReference.description"), ogAlt: t("ogAlt") });
}

export default async function ApiReferencePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const messages = await getMessages();
  const m = messages.docs as DocsMessages;
  const footer = (messages.landing as (typeof en)["landing"]).footer;
  const signature = messages.signature as SignatureLabels;
  return <><Container><ApiDocs m={m} siteUrl={getConfig().siteUrl} /></Container><SiteFooter locale={locale} path="/api-reference" labels={footer} signature={signature} /></>;
}
