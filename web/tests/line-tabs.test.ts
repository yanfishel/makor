import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LineTab, LineTabs, LineTabsContent, LineTabsList } from "@/components/LineTabs";

const render = () =>
  renderToStaticMarkup(
    createElement(LineTabs, { defaultValue: "b" },
      createElement(LineTabsList, null, createElement(LineTab, { value: "a" }, "A"), createElement(LineTab, { value: "b" }, "B"), createElement(LineTab, { value: "c" }, "C")),
      createElement(LineTabsContent, { value: "a" }, "content a"),
      createElement(LineTabsContent, { value: "b" }, "content b")));

describe("LineTabs", () => {
  it("draws one full-width rule under the list and one highlight indicator under the active tab", () => {
    const html = render();
    expect(html).toMatch(/data-slot="tabs-list"[^>]*class="[^"]*w-full[^"]*border-b/);
    expect((html.match(/data-slot="line-tab-indicator"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/data-state="active"[^>]*>B<span[^>]*data-slot="line-tab-indicator"[^>]*class="[^"]*bg-highlight/);
  });
  it("gives every trigger horizontal padding and no box border, and shows only the active content", () => {
    const html = render();
    const triggers = html.match(/<button[^>]*data-slot="tabs-trigger"[^>]*>/g) ?? [];
    expect(triggers).toHaveLength(3);
    for (const t of triggers) { expect(t).toMatch(/px-\d/); expect(t).toContain("border-0"); expect(t).toContain("dark:data-active:bg-transparent"); }
    expect(html).toContain("content b");
    expect(html).not.toContain("content a");
  });
});
