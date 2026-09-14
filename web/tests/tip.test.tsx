import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tip } from "@/components/Tip";

const render = (text: string | null | undefined) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <Tip text={text}><b>chip</b></Tip>
    </TooltipProvider>,
  );

describe("Tip", () => {
  it("wraps its child in a tooltip trigger carrying the text", () => {
    const html = render("ENGINE_ERROR");
    expect(html).toContain('data-tip="ENGINE_ERROR"');
    expect(html).toContain("<b>chip</b>");
    expect(html).not.toContain("title=");
  });
  it("renders the child alone when there is nothing to say", () => {
    for (const t of [null, undefined, ""]) expect(render(t)).toBe("<b>chip</b>");
  });
});
