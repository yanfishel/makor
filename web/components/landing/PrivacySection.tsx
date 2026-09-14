import { Container } from "@/components/Container";
import { GuillocheBand } from "@/components/Guilloche";
import type { LandingMessages } from "./Landing";

export function PrivacySection({ m, policyHref }: { m: LandingMessages["privacy"]; policyHref: string }) {
  return (
    <section id="privacy" className="relative overflow-hidden bg-ink py-10 text-ink-foreground sm:py-12">
      <GuillocheBand className="inset-x-0 top-auto bottom-0 h-40 text-ink-foreground/25" y={0.9} lines={22} amplitude={90} wavelength={240} />
      <Container className="relative">
        <h2 className="text-3xl font-semibold tracking-tight">{m.title}</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-x-10">
          {m.points.map((x) => <li key={x} className="border-s-2 border-highlight ps-4 text-[15px]">{x}</li>)}
        </ul>
        <p className="mt-8 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-foreground/15 pt-4 text-xs text-ink-foreground/70">
          <span>{m.law}</span>
          <a href={policyHref} className="underline underline-offset-2 hover:text-ink-foreground">{m.policyLink}</a>
        </p>
      </Container>
    </section>
  );
}
