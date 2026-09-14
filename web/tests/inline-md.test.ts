import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineMd } from "@/components/InlineMd";

const render = (text: string) => renderToStaticMarkup(createElement(InlineMd, { text }));

describe("InlineMd", () => {
  it("renders `code` spans LTR and *emphasis* as <em>, the rest as plain text", () => {
    expect(render("Multipart field `file` (image) → *store results* off")).toBe(
      'Multipart field <code dir="ltr" class="rounded bg-muted px-1 font-mono text-[0.9em]">file</code> (image) → <em>store results</em> off',
    );
  });
  it("leaves unbalanced markers and HTML alone", () => {
    expect(render("a * b `c <d>")).toBe("a * b `c &lt;d&gt;");
  });
  it("renders [text](url) as a link for https, mailto and site paths only", () => {
    expect(render("see [the policy](/privacy) or [Anthropic](https://www.anthropic.com/legal/commercial-terms)")).toBe(
      'see <a href="/privacy" class="text-highlight hover:underline">the policy</a> or <a href="https://www.anthropic.com/legal/commercial-terms" class="text-highlight hover:underline" rel="noreferrer">Anthropic</a>',
    );
    expect(render("[mail](mailto:a@b.c)")).toContain('href="mailto:a@b.c"');
    expect(render("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
  });
  it("renders plain text without a wrapper element", () => {
    expect(render("plain")).toBe("plain");
  });
});
