import type en from "@/messages/en.json";
import { REQUEST_ACCESS_SUBJECT, localePath, mailtoHref } from "@/lib/links";
import { Container } from "@/components/Container";
import { SiteFooter } from "@/components/public/SiteFooter";
import type { SignatureLabels } from "@/components/Signature";
import { ApiSection } from "./ApiSection";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { PrivacySection } from "./PrivacySection";
import { RegistriesSection } from "./RegistriesSection";
import { TwoWays } from "./TwoWays";
import { WhatIsRead } from "./WhatIsRead";

export type LandingMessages = (typeof en)["landing"];

export function Landing({ m, locale, siteUrl, trialDocs, githubUrl, signature }: { m: LandingMessages; locale: string; siteUrl: string; trialDocs: number; githubUrl: string; signature: SignatureLabels }) {
  const p = (path: string) => localePath(locale, path);
  const n = (s: string) => s.replace("{n}", String(trialDocs));
  const copy = { copy: m.copy, copied: m.copied };
  const requestAccess = mailtoHref(REQUEST_ACCESS_SUBJECT);
  return (
    <div className="space-y-24">
      <Hero m={m.hero} cloudHref={requestAccess} githubUrl={githubUrl} n={n} />
      <Container className="space-y-24">
        <HowItWorks m={m.how} />
        <WhatIsRead m={m.reads} />
        <RegistriesSection m={m.registries} />
      </Container>
      <PrivacySection m={m.privacy} policyHref={p("/privacy")} />
      <Container className="space-y-24">
        <TwoWays m={m.ways} cloudHref={requestAccess} githubUrl={githubUrl} n={n} copy={copy} />
        <ApiSection m={m.api} siteUrl={siteUrl} docsHref={p("/api-reference")} copy={copy} />
      </Container>
      <SiteFooter locale={locale} labels={m.footer} githubUrl={githubUrl} signature={signature} />
    </div>
  );
}
