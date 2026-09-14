import { GITHUB_URL, authHref, localePath } from "@/lib/links";
import { Container } from "@/components/Container";
import { Logo } from "@/components/Logo";
import { Copyright, SignatureLine, type SignatureLabels } from "@/components/Signature";

export interface FooterLabels { docs: string; terms: string; privacy: string; signIn: string; privacyNote: string }

export function SiteFooter({ locale, path = "/", labels, signature, githubUrl = GITHUB_URL }: { locale: string; path?: string; labels: FooterLabels; signature: SignatureLabels; githubUrl?: string }) {
  const p = (x: string) => localePath(locale, x);
  const other = locale === "he" ? "en" : "he";
  return (
    <footer id="footer" className="mt-24 border-t border-border text-[13px] text-muted-foreground">
      <Container className="grid gap-8 py-10 md:grid-cols-[1.4fr_1fr_1fr_auto]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs"><Copyright text={signature.copyright} />. {labels.privacyNote}</p>
        </div>
        <ul className="space-y-2">
          <li><a href={p("/api-reference")} className="hover:text-foreground">{labels.docs}</a></li>
          <li><a href={githubUrl} className="hover:text-foreground">GitHub</a></li>
          <li><a href={authHref(locale, "sign-in")} className="hover:text-foreground">{labels.signIn}</a></li>
        </ul>
        <ul className="space-y-2">
          <li><a href={p("/terms")} className="hover:text-foreground">{labels.terms}</a></li>
          <li><a href={p("/privacy")} className="hover:text-foreground">{labels.privacy}</a></li>
        </ul>
        {/* End-aligned: right in LTR, left in RTL. */}
        <div className="justify-self-end">
          <a href={localePath(other, path)} className="hover:text-foreground" lang={other}>{other === "he" ? "עברית" : "English"}</a>
        </div>
      </Container>
      <SignatureLine labels={signature} />
    </footer>
  );
}
