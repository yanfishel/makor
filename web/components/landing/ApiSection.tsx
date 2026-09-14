import { ArrowRight } from "lucide-react";
import { LineTab, LineTabs, LineTabsContent, LineTabsList } from "@/components/LineTabs";
import { CodeBlock, type CopyLabels } from "@/components/CodeBlock";
import { SHORT_RESPONSE, snippets } from "@/lib/api-reference";
import type { LandingMessages } from "./Landing";

export function ApiSection({ m, siteUrl, docsHref, copy }: { m: LandingMessages["api"]; siteUrl: string; docsHref: string; copy: CopyLabels }) {
  const s = snippets(siteUrl).extract;
  return (
    <section id="api" className="scroll-mt-14 space-y-6">
      <div><h2 className="text-3xl font-semibold tracking-tight">{m.title}</h2><p className="mt-1 max-w-2xl text-muted-foreground">{m.text}</p></div>
      <div className="grid gap-6 border-t border-foreground pt-6 lg:grid-cols-2">
        <LineTabs defaultValue="curl" dir="ltr" lang="en" className="min-w-0">
          <LineTabsList>
            <LineTab value="curl">curl</LineTab><LineTab value="python">Python</LineTab><LineTab value="ts">TypeScript</LineTab>
          </LineTabsList>
          <LineTabsContent value="curl"><CodeBlock code={s.curl} labels={copy} /></LineTabsContent>
          <LineTabsContent value="python"><CodeBlock code={s.python} labels={copy} /></LineTabsContent>
          <LineTabsContent value="ts"><CodeBlock code={s.typescript} labels={copy} /></LineTabsContent>
        </LineTabs>
        <div dir="ltr" lang="en" className="min-w-0">
          <div className="mb-2 border-b border-border px-3 pt-1 pb-2 font-mono text-[13px] font-medium">response</div>
          <CodeBlock code={SHORT_RESPONSE} labels={copy} />
        </div>
      </div>
      <a href={docsHref} className="inline-flex items-center gap-1 font-medium text-highlight hover:underline">{m.docsLink}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></a>
    </section>
  );
}
