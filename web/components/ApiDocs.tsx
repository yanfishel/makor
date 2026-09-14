import type en from "@/messages/en.json";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CodeBlock } from "@/components/CodeBlock";
import { DocsToc } from "@/components/DocsToc";
import { LineTab, LineTabs, LineTabsContent, LineTabsList } from "@/components/LineTabs";
import { InlineMd } from "@/components/InlineMd";
import { PRICES_DATE } from "@/lib/pricing";
import { ENDPOINT_GROUPS, ENDPOINTS, ERROR_CODES, EXAMPLE_RESPONSE, snippets } from "@/lib/api-reference";
import { cn } from "@/lib/utils";

export type DocsMessages = (typeof en)["docs"];

const METHOD_CLASS: Record<string, string> = { GET: "border-success/25 bg-success/10 text-success", POST: "border-highlight/30 bg-highlight/10 text-highlight", PATCH: "border-warning/25 bg-warning/10 text-warning", DELETE: "border-destructive/25 bg-destructive/10 text-destructive" };
const Method = ({ m }: { m: string }) => <Badge variant="outline" className={cn("rounded-sm font-mono", METHOD_CLASS[m])}>{m}</Badge>;

export function ApiDocs({ m, siteUrl }: { m: DocsMessages; siteUrl: string }) {
  const s = snippets(siteUrl);
  const endpoints = m.endpoints as Record<string, string>;
  const errors = m.errors as Record<string, string>;
  const labels = { copy: m.copy, copied: m.copied };
  const toc = [
    { id: "auth", label: m.auth.title }, { id: "image", label: m.image.title }, { id: "endpoints", label: m.endpointsTitle },
    ...ENDPOINT_GROUPS.map((g) => ({ id: `endpoints-${g}`, label: m.endpointGroups[g], sub: true })),
    { id: "limits", label: m.limits.title }, { id: "response", label: m.responseTitle }, { id: "cost", label: m.cost.title }, { id: "errors", label: m.errorsTitle }, { id: "snippets", label: m.snippetsTitle },
  ];
  const H2 = ({ id, children }: { id: string; children: string }) => <h2 id={id} className="scroll-mt-20 text-xl font-semibold tracking-tight">{children}</h2>;
  const H3 = ({ id, children }: { id?: string; children: string }) => <h3 id={id} className="scroll-mt-20 text-base font-medium">{children}</h3>;
  const examples = [["extract", s.extract], ["search", s.search], ["settings", s.settings]] as const;
  return (
    <div className="grid gap-10 lg:grid-cols-[13rem_1fr]">
      <aside className="hidden lg:block"><DocsToc items={toc} title={m.toc} className="sticky top-20" /></aside>
      <div className="min-w-0 space-y-12">
        <header><h1 className="text-3xl font-semibold tracking-tight">{m.title}</h1><p className="mt-2 text-muted-foreground"><InlineMd text={m.intro} /></p></header>
        {/* Narrow screens: the same list, inline above the sections, since the side column is gone. */}
        <nav aria-label={m.toc} className="flex flex-wrap gap-x-4 gap-y-1 border-y border-border py-3 font-mono text-[13px] lg:hidden">
          {toc.map((it) => <a key={it.id} href={`#${it.id}`} className="text-muted-foreground hover:text-foreground">{it.label}</a>)}
        </nav>
        <section className="space-y-3"><H2 id="auth">{m.auth.title}</H2><p><InlineMd text={m.auth.text} /></p><CodeBlock code={`Authorization: Bearer ak_…`} labels={labels} /></section>
        <section className="space-y-3"><H2 id="image">{m.image.title}</H2><ul className="list-disc space-y-1.5 ps-5">{m.image.items.map((item, i) => <li key={i}><InlineMd text={item} /></li>)}</ul></section>
        <section className="space-y-3">
          <H2 id="endpoints">{m.endpointsTitle}</H2>
          {ENDPOINT_GROUPS.map((group) => (
            <div key={group} className="space-y-2 pt-2">
              <H3 id={`endpoints-${group}`}>{m.endpointGroups[group]}</H3>
              <div className="overflow-x-auto border-t border-foreground"><Table>
                <TableHeader><TableRow><TableHead>{m.colMethod}</TableHead><TableHead>{m.colPath}</TableHead><TableHead>{m.colDescription}</TableHead></TableRow></TableHeader>
                <TableBody>{ENDPOINTS.filter((e) => e.group === group).map((e) => (
                  <TableRow key={e.method + e.path}><TableCell dir="ltr"><Method m={e.method} /></TableCell><TableCell className="whitespace-nowrap font-mono text-xs" dir="ltr">{e.path}</TableCell><TableCell className="min-w-[16rem] whitespace-normal"><InlineMd text={endpoints[e.key]} /></TableCell></TableRow>
                ))}</TableBody>
              </Table></div>
            </div>
          ))}
          <p className="text-sm text-muted-foreground"><InlineMd text={m.sessionOnly} /></p>
        </section>
        <section className="space-y-3"><H2 id="limits">{m.limits.title}</H2><ul className="list-disc space-y-1.5 ps-5">{m.limits.items.map((item, i) => <li key={i}><InlineMd text={item} /></li>)}</ul></section>
        <section className="space-y-3"><H2 id="response">{m.responseTitle}</H2><ul className="list-disc space-y-1.5 ps-5">{m.responseItems.map((item, i) => <li key={i}><InlineMd text={item} /></li>)}</ul><CodeBlock code={EXAMPLE_RESPONSE} labels={labels} /></section>
        <section className="space-y-3"><H2 id="cost">{m.cost.title}</H2><p><InlineMd text={m.cost.text.replace("{date}", PRICES_DATE)} /></p></section>
        <section className="space-y-3">
          <H2 id="errors">{m.errorsTitle}</H2>
          <p><InlineMd text={m.errorsText} /></p>
          <CodeBlock code={`{ "error": "TRIAL_EXHAUSTED", "detail": "…", "trial_docs": 5 }`} labels={labels} />
          <div className="overflow-x-auto border-t border-foreground"><Table>
            <TableHeader><TableRow><TableHead>{m.colStatus}</TableHead><TableHead>{m.colCode}</TableHead><TableHead>{m.colDescription}</TableHead></TableRow></TableHeader>
            <TableBody>{ERROR_CODES.map((e) => (
              <TableRow key={e.code}><TableCell className="font-mono" dir="ltr">{e.status || "↑"}</TableCell><TableCell className="whitespace-nowrap font-mono text-xs" dir="ltr">{e.code}</TableCell><TableCell className="min-w-[16rem] whitespace-normal"><InlineMd text={errors[e.key]} /></TableCell></TableRow>
            ))}</TableBody>
          </Table></div>
        </section>
        <section className="space-y-3">
          <H2 id="snippets">{m.snippetsTitle}</H2>
          {examples.map(([key, code]) => (
            <div key={key} className="space-y-2 pt-2">
              <H3>{m.snippetTitles[key]}</H3>
              <LineTabs defaultValue="curl" dir="ltr" lang="en" className="min-w-0 gap-3">
                <LineTabsList><LineTab value="curl">curl</LineTab><LineTab value="python">Python</LineTab><LineTab value="ts">TypeScript</LineTab></LineTabsList>
                <LineTabsContent value="curl"><CodeBlock code={code.curl} labels={labels} /></LineTabsContent>
                <LineTabsContent value="python"><CodeBlock code={code.python} labels={labels} /></LineTabsContent>
                <LineTabsContent value="ts"><CodeBlock code={code.typescript} labels={labels} /></LineTabsContent>
              </LineTabs>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
