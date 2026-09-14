import { getMessages, getTranslations } from "next-intl/server";
import { Landing, type LandingMessages } from "@/components/landing/Landing";
import type { SignatureLabels } from "@/components/Signature";
import { getConfig } from "@/lib/config";
import { GITHUB_URL } from "@/lib/links";
import { SITE_NAME, localeHref, ogImage } from "@/lib/seo";

/** The landing with its messages and config, shared by `/` (signed-out cloud visitors) and `/about` (everyone). */
export async function LandingPage({ locale }: { locale: string }) {
  const cfg = getConfig();
  const messages = await getMessages();
  const t = await getTranslations({ locale, namespace: "meta" });
  // schema.org description of the product for search engines. `<` is escaped so no string in it
  // can close the script element.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: `${cfg.siteUrl}${localeHref(locale, "/")}`,
    description: t("description"),
    inLanguage: locale,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
    image: `${cfg.siteUrl}${ogImage(locale, t("ogAlt")).url}`,
    sameAs: [GITHUB_URL],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Landing m={messages.landing as LandingMessages} locale={locale} siteUrl={cfg.siteUrl} trialDocs={cfg.trialDocs} githubUrl={GITHUB_URL} signature={messages.signature as SignatureLabels} />
    </>
  );
}
