import { Mail } from "lucide-react";
import { GithubIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CodeBlock, type CopyLabels } from "@/components/CodeBlock";
import type { LandingMessages } from "./Landing";

export const COMPOSE_CMD = "AUTH_MODE=none MAKOR_BACKEND=ollama docker compose --profile ollama up -d --build";

export function TwoWays({ m, cloudHref, githubUrl, n, copy }: { m: LandingMessages["ways"]; cloudHref: string; githubUrl: string; n: (s: string) => string; copy: CopyLabels }) {
  return (
    <section id="ways" className="space-y-6">
      <div><h2 className="text-3xl font-semibold tracking-tight">{m.title}</h2><p className="mt-1 text-muted-foreground">{m.lead}</p></div>
      <div className="grid border-t border-foreground md:grid-cols-2">
        <div className="min-w-0 space-y-4 py-6 md:border-e md:border-border md:pe-8">
          <h3 className="text-lg font-medium">{m.cloud.title}</h3>
          <p className="text-[15px] text-muted-foreground">{n(m.cloud.text)}</p>
          <Button asChild variant="highlight"><a href={cloudHref}><Mail />{m.cloud.cta}</a></Button>
        </div>
        <div className="min-w-0 space-y-4 border-t border-border py-6 md:border-t-0 md:ps-8">
          <h3 className="text-lg font-medium">{m.selfHost.title}</h3>
          <p className="text-[15px] text-muted-foreground">{m.selfHost.text}</p>
          <CodeBlock code={COMPOSE_CMD} labels={copy} />
          <Button asChild variant="outline"><a href={githubUrl}><GithubIcon className="size-4" />{m.selfHost.cta}</a></Button>
        </div>
      </div>
    </section>
  );
}
