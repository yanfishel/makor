import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LOCKUP_WIDTH, Logo, LogoMark, MONOGRAM_CHEVRONS, MONOGRAM_M, WORDMARK } from "@/components/Logo";

/** The MRZ monogram: an M over three filler chevrons, each an open "<" of three points. */
const CHEVRONS = /(M[\d.]+ [\d.]+l-[\d.]+ [\d.]+ [\d.]+ [\d.]+)/g;

describe("Logo", () => {
  it("renders mark and wordmark as one labelled LTR drawing", () => {
    const html = renderToStaticMarkup(createElement(Logo));
    expect(html).toMatch(/^<span dir="ltr"/);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('role="img" aria-label="Makor"');
    expect(html).toContain(`viewBox="0 0 ${LOCKUP_WIDTH} 28"`);
    expect(html).toContain(`d="${WORDMARK}"`);
    expect(html).not.toContain("lucide");
  });
  it("draws the MRZ monogram: an M over three filler chevrons in the accent", () => {
    const html = renderToStaticMarkup(createElement(LogoMark));
    expect(html).toMatch(/<path d="M[\d.]+ [\d.]+V[\d.]+l[\d.]+ [\d.]+ [\d.]+-[\d.]+V[\d.]+"/);
    const chevrons = html.match(/<path d="([^"]+)"[^>]*var\(--glyph-accent\)/)?.[1] ?? "";
    expect(chevrons.match(CHEVRONS)).toHaveLength(3);
  });
  it("sets the M and the chevron row to one width, one stroke, centred in the tile", () => {
    // M: "Mx0 yBottomVyTopl d d d-dVyBottom" spans x0..x0+2d; a chevron "Mx y l-w w w w" spans x-w..x.
    const [x0, , , d] = MONOGRAM_M.match(/[\d.]+/g)!.map(Number);
    const rows = [...MONOGRAM_CHEVRONS.matchAll(/M([\d.]+) [\d.]+l-([\d.]+)/g)].map((m) => [Number(m[1]) - Number(m[2]), Number(m[1])]);
    expect(Math.min(...rows.map((r) => r[0]))).toBeCloseTo(x0, 5);
    expect(Math.max(...rows.map((r) => r[1]))).toBeCloseTo(x0 + 2 * d, 5);
    expect(x0 + d).toBeCloseTo(12, 5);
    const html = renderToStaticMarkup(createElement(LogoMark));
    const widths = [...html.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1]);
    expect(new Set(widths).size).toBe(1);
    // Vertically: from the M's top stroke edge to the last chevron's bottom stroke edge, centred on 12.
    const half = Number(widths[0]) / 2;
    const top = MONOGRAM_M.match(/[\d.]+/g)!.map(Number)[2] - half;
    const [, cy, cw] = MONOGRAM_CHEVRONS.match(/M[\d.]+ ([\d.]+)l-([\d.]+)/)!.map(Number);
    expect((top + (cy + 2 * cw + half)) / 2).toBeCloseTo(12, 5);
  });
  it("sets the wordmark in outlines after the tile, inside the lockup", () => {
    const xs = [...WORDMARK.matchAll(/[MLHQ]([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(38); // the 28 px tile and its 10 px gap
    expect(Math.max(...xs)).toBeLessThanOrEqual(LOCKUP_WIDTH);
  });
  it("narrows to the tile inside a collapsed icon sidebar, and flips colours on ink", () => {
    const html = renderToStaticMarkup(createElement(Logo, { collapsible: true }));
    expect(html).toContain("group-data-[collapsible=icon]:w-7");
    expect(html).toContain("group-data-[collapsible=icon]:opacity-0");
    expect(renderToStaticMarkup(createElement(Logo))).not.toContain("group-data-[collapsible=icon]");
    expect(renderToStaticMarkup(createElement(Logo, { tone: "ink" }))).toContain("text-sidebar-foreground");
  });
  it("exposes the bare mark", () => {
    expect(renderToStaticMarkup(createElement(LogoMark, { className: "size-6" }))).toContain('class="size-6"');
  });
  it("ships the same drawing as the README's brand lockups", () => {
    for (const theme of ["light", "dark"]) {
      const svg = readFileSync(path.resolve(__dirname, `../public/brand/logo-${theme}.svg`), "utf8");
      expect(svg).toContain(`d="${WORDMARK}"`);
      expect(svg).toContain(`d="${MONOGRAM_M}"`);
      expect(svg).toContain(`d="${MONOGRAM_CHEVRONS}"`);
    }
  });
  it("ships the same monogram as the favicon", () => {
    const icon = readFileSync(path.resolve(__dirname, "../app/icon.svg"), "utf8");
    expect(icon).toContain(`d="${MONOGRAM_M}"`);
    expect(icon).toContain(`d="${MONOGRAM_CHEVRONS}"`);
  });
});
