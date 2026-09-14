import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocsToc } from "@/components/DocsToc";

const items = [{ id: "auth", label: "Authentication" }, { id: "image", label: "Image requirements" }, { id: "errors", label: "Errors" }];

describe("DocsToc", () => {
  it("links every section by its hash and names the list", () => {
    const html = renderToStaticMarkup(createElement(DocsToc, { items, title: "On this page" }));
    for (const it of items) expect(html).toContain(`href="#${it.id}"`);
    expect(html).toContain("On this page");
    expect(html).toContain('aria-label="On this page"');
  });
  it("marks the first section current before any scroll", () => {
    const html = renderToStaticMarkup(createElement(DocsToc, { items, title: "On this page" }));
    expect(html).toMatch(/<a[^>]*href="#auth"[^>]*aria-current="location"/);
    expect(html).not.toMatch(/<a[^>]*href="#image"[^>]*aria-current/);
  });
});
