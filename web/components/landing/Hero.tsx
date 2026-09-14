import { Rocket } from "lucide-react";
import type { ReactNode } from "react";
import { Container } from "@/components/Container";
import { GithubIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HeroBackdrop, type HeroBackdropVariant } from "./HeroBackdrop";
import { HeroFan } from "./HeroFan";
import type { LandingMessages } from "./Landing";

/** The hero background: `band` (guilloche wave + halo) is the shipped look; `halo` (grain + glow) is the kept alternative. */
const BACKDROP: HeroBackdropVariant = "band";

/** A two-line call to action: an icon as tall as the two lines at the start, the verb on top, the
 * smaller promise below. The icons carry their own `size-9`: Button's `[&_svg:not([class*='size-'])]`
 * rule outranks a plain `[&_svg]` override. */
function Cta({ variant, href, icon, label, sub }: { variant: "highlight" | "outline"; href: string; icon: ReactNode; label: string; sub: string }) {
  return (
    <Button asChild variant={variant} className="h-auto min-w-48 justify-start gap-2.5 ps-2.5 pe-4 py-2 text-start">
      <a href={href}>
        <span className={cn("shrink-0", variant === "highlight" ? "text-highlight-foreground/90" : "text-foreground/70")}>{icon}</span>
        <span className="flex flex-col">
          <span className="text-base font-semibold leading-tight">{label}</span>
          <span className={cn("text-xs font-normal leading-tight", variant === "highlight" ? "text-highlight-foreground/80" : "text-muted-foreground")}>{sub}</span>
        </span>
      </a>
    </Button>
  );
}

export function Hero({ m, cloudHref, githubUrl, n }: { m: LandingMessages["hero"]; cloudHref: string; githubUrl: string; n: (s: string) => string }) {
  // Three grid children: text (title, subtitle, CTAs), the fan, the facts. Below lg they stack
  // in that order — the fan between the buttons and the facts; from lg the fan takes the
  // second column across both rows and the facts drop under the text.
  return (
    <section id="hero" className="relative isolate overflow-hidden">
      <HeroBackdrop variant={BACKDROP} />
      <Container className="grid gap-10 pt-10 pb-6 lg:grid-cols-[1.05fr_1fr] lg:gap-x-10 lg:gap-y-6 lg:pt-16">
        <div className="space-y-6 lg:col-start-1 lg:row-start-1">
          {/* The title is two lines by design ("Documents in, / JSON out"): the message carries the break. */}
          <h1 className="text-5xl font-semibold tracking-[-0.025em] whitespace-pre-line lg:text-6xl">{m.title}</h1>
          <p className="max-w-xl text-lg text-muted-foreground">{m.subtitle}</p>
          <div className="flex flex-wrap gap-3">
            <Cta variant="highlight" href={cloudHref} icon={<Rocket className="size-9" strokeWidth={1.5} />} label={m.ctaCloud.label} sub={n(m.ctaCloud.sub)} />
            <Cta variant="outline" href={githubUrl} icon={<GithubIcon className="size-9" />} label={m.ctaSelfHost.label} sub={m.ctaSelfHost.sub} />
          </div>
        </div>
        {/* Capped at 520 px (its desktop width) and centred when stacked, or the cards (start) and
            the ledger (end) drift apart in the full-width column. */}
        <div className="mx-auto w-full max-w-[520px] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mx-0 lg:max-w-none lg:self-center"><HeroFan label={m.demoLabel} /></div>
        {/* Dividers are foreground/20 rather than the border token: on the paper background a
            1 px --border hairline is too faint to survive a non-integer device pixel ratio. Below
            lg the row is centred under the centred fan; from lg the facts fill the text column. */}
        <ul className="flex flex-col border-t border-foreground pt-3 text-[13px] text-muted-foreground max-lg:text-center sm:flex-row sm:divide-x sm:divide-foreground/20 sm:max-lg:justify-center lg:col-start-1 lg:row-start-2">
          {m.facts.map((f) => <li key={f} className="max-sm:py-1 sm:px-4 lg:flex-1 lg:first:ps-0 lg:last:pe-0">{f}</li>)}
        </ul>
      </Container>
    </section>
  );
}
