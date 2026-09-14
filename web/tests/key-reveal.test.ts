import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyReveal } from "@/components/KeyReveal";

describe("KeyReveal", () => {
  it("shows the key as LTR code with a copy button and no request example", () => {
    const html = renderToStaticMarkup(createElement(KeyReveal, { value: "ak_test123", labels: { copy: "Copy", copied: "Copied" } }));
    expect(html).toMatch(/<code[^>]*dir="ltr"[^>]*>ak_test123<\/code>/);
    expect(html).toContain('aria-label="Copy"');
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("curl");
  });
});
