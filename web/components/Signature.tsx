import type React from "react";
import { Container } from "@/components/Container";
import { GithubIcon, MailIcon } from "@/components/icons";
import { GITHUB_URL, localePath, mailtoHref } from "@/lib/links";
import { cn } from "@/lib/utils";

export interface SignatureLabels { madeWith: string; copyright: string; terms: string; privacy: string; email: string; github: string; fishart: string }

const ICON_LINK = "flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-highlight hover:text-highlight";

/** The author's wordmark, linked. */
export function FishartLink({ label, className }: { label: string; className?: string }) {
  return (
    <a href="https://fishart.co.il" target="_blank" rel="noopener noreferrer" aria-label={label} className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a 400×93 static wordmark; next/image gains nothing and rewrites the src in tests */}
      <img src="/fishart.png" alt="fishart" width={90} height={21} className="h-4 w-auto opacity-90 invert dark:invert-0" />
    </a>
  );
}

/** E-mail and GitHub as round icon links. */
export function ContactLinks({ labels, className }: { labels: Pick<SignatureLabels, "email" | "github">; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <a href={mailtoHref("Makor feedback")} aria-label={labels.email} className={ICON_LINK}><MailIcon /></a>
      <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label={labels.github} className={ICON_LINK}><GithubIcon /></a>
    </div>
  );
}

/** "Made with ♥ …" with the heart coloured. */
export function MadeWith({ text, className }: { text: string; className?: string }) {
  const [before, after] = text.split("♥");
  return <p className={cn("whitespace-nowrap", className)}>{before}<span className="text-destructive">♥</span>{after}</p>;
}

/** "© year Makor" as an isolated run (its first strong letter makes it LTR): in Hebrew it would otherwise
 * reorder around its digits. Inline on purpose — a `dir="ltr"` block would also align to the left. */
export function Copyright({ text }: { text: string }) {
  return <bdi>{text.replace("{year}", String(new Date().getFullYear()))}</bdi>;
}

/** The app's bottom bar, spanning its main: the copyright and the two legal pages (a new tab — they leave the app) at the start, the contact icons at the end. */
export function Signature({ labels, locale, className }: { labels: SignatureLabels; locale: string; className?: string }) {
  const link = "transition-colors hover:text-foreground";
  return (
    <div className={cn("border-t border-border px-4 py-4 text-[13px] text-muted-foreground sm:px-6", className)}>
      <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <Copyright text={labels.copyright} />
          <span aria-hidden>·</span>
          <a href={localePath(locale, "/terms")} target="_blank" rel="noopener" className={link}>{labels.terms}</a>
          <span aria-hidden>·</span>
          <a href={localePath(locale, "/privacy")} target="_blank" rel="noopener" className={link}>{labels.privacy}</a>
        </p>
        <ContactLinks labels={labels} />
      </div>
    </div>
  );
}

/** The public pages' last line, its rule as wide as the Container: fishart at the start, the made-with text centred, the contact icons at the end. */
export function SignatureLine({ labels }: { labels: SignatureLabels }) {
  return (
    <Container>
      <div className="grid grid-cols-1 items-center gap-3 border-t border-border py-4 text-[13px] text-muted-foreground sm:grid-cols-[1fr_auto_1fr]">
        <FishartLink label={labels.fishart} className="justify-self-center sm:justify-self-start" />
        <MadeWith text={labels.madeWith} className="justify-self-center" />
        <ContactLinks labels={labels} className="justify-self-center sm:justify-self-end" />
      </div>
    </Container>
  );
}
