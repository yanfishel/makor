import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroBackdrop } from "@/components/landing/HeroBackdrop";
import { HeroFan } from "@/components/landing/HeroFan";

describe("HeroBackdrop", () => {
  it("renders the band variant with the guilloche and a halo", () => {
    const html = renderToStaticMarkup(createElement(HeroBackdrop, { variant: "band" }));
    expect(html).toContain("<mask");
    expect((html.match(/<path /g) ?? []).length).toBeGreaterThan(20);
    expect(html).toContain("radial-gradient");
  });
  it("renders the halo variant with grain and no guilloche", () => {
    const html = renderToStaticMarkup(createElement(HeroBackdrop, { variant: "halo" }));
    expect(html).toContain("feTurbulence");
    expect(html).not.toContain("<mask");
  });
});

describe("HeroFan", () => {
  it("is an LTR figure with the three synthetic documents and the result chips", () => {
    const html = renderToStaticMarkup(createElement(HeroFan, { label: "demo" }));
    expect(html).toMatch(/role="img"[^>]*dir="ltr"/);
    expect(html).toContain("PASSPORT");
    expect(html).toContain("תעודת זהות");
    expect(html).toContain("80001234");
    expect(html).toContain("123456782");
    expect(html).toContain("passport_number");
    expect(html).toContain("verified");
  });
  it("carries the scanner beam on the passport: a highlight core with its glow and afterglow", () => {
    const html = renderToStaticMarkup(createElement(HeroFan, { label: "demo" }));
    expect((html.match(/data-slot="scan-beam"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-slot="scan-beam-core"');
    expect(html).toContain('data-slot="scan-beam-afterglow"');
    expect(html).toContain('data-slot="scan-beam-spark"');
    expect((html.match(/data-slot="scan-overlay"/g) ?? []).length).toBe(1);
    expect((html.match(/P&lt;ISRISRAELI/g) ?? []).length).toBe(2); // the overlay repeats the passport body, hot
  });
});
