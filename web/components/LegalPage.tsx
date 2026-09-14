import type en from "@/messages/en.json";
import { DocsToc } from "@/components/DocsToc";
import { InlineMd } from "@/components/InlineMd";
import { CONTACT_EMAIL, localePath } from "@/lib/links";
import { formatLegalDate } from "@/lib/legal";

export type LegalMessages = (typeof en)["legal"];
export type LegalDoc = LegalMessages["terms"];

/**
 * One legal document (Terms of Use, Privacy Policy) laid out like /docs: the spy menu beside
 * numbered sections of paragraphs. `{email}` (only ever inside a `mailto:` link — the address is
 * never printed as text), `{terms}` and `{privacy}` in the messages become the contact address and
 * the locale's paths, so neither language hardcodes them.
 */
export function LegalPage({ doc, m, locale }: { doc: LegalDoc; m: LegalMessages; locale: string }) {
  const fill = (text: string) => text
    .replaceAll("{email}", CONTACT_EMAIL)
    .replaceAll("{terms}", localePath(locale, "/terms"))
    .replaceAll("{privacy}", localePath(locale, "/privacy"));
  const toc = doc.sections.map((s, i) => ({ id: s.id, label: `${i + 1}. ${s.title}` }));
  return (
    <div className="grid gap-10 lg:grid-cols-[13rem_1fr]">
      <aside className="hidden lg:block"><DocsToc items={toc} title={m.toc} className="sticky top-20" /></aside>
      <article className="min-w-0 max-w-3xl space-y-10">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{m.updated.replace("{date}", formatLegalDate(locale))}</p>
          <p className="mt-4 text-muted-foreground"><InlineMd text={fill(doc.intro)} /></p>
        </header>
        <nav aria-label={m.toc} className="flex flex-wrap gap-x-4 gap-y-1 border-y border-border py-3 text-[13px] lg:hidden">
          {toc.map((it) => <a key={it.id} href={`#${it.id}`} className="text-muted-foreground hover:text-foreground">{it.label}</a>)}
        </nav>
        {doc.sections.map((s, i) => (
          <section key={s.id} className="space-y-3">
            <h2 id={s.id} className="scroll-mt-20 text-xl font-semibold tracking-tight">{i + 1}. {s.title}</h2>
            {s.items.map((text, j) => <p key={j} className="leading-relaxed"><InlineMd text={fill(text)} /></p>)}
          </section>
        ))}
      </article>
    </div>
  );
}
