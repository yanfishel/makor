import { Fragment, type ReactNode } from "react";

// Message strings in /docs and the legal pages carry three inline marks: `code`, *emphasis* and
// [text](url), the url limited to https:, mailto: and a site path. Anything else is plain text
// (React escapes it). Unbalanced markers and other urls are printed as written.
const TOKEN = /(`[^`]+`|\*[^*]+\*|\[[^\]]+\]\((?:https:\/\/|mailto:|\/)[^)\s]*\))/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

export function InlineMd({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter((p) => p !== "");
  return (
    <>
      {parts.map((p, i): ReactNode => {
        if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) {
          return <code key={i} dir="ltr" className="rounded bg-muted px-1 font-mono text-[0.9em]">{p.slice(1, -1)}</code>;
        }
        if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
        const link = LINK.exec(p);
        if (link) {
          const external = link[2].startsWith("https://");
          return <a key={i} href={link[2]} className="text-highlight hover:underline" rel={external ? "noreferrer" : undefined}>{link[1]}</a>;
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
