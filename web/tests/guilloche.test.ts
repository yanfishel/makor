import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { band } from "@/lib/guilloche";
import { GuillocheBand } from "@/components/Guilloche";

describe("band", () => {
  const opts = { width: 1200, height: 400, lines: 12, amplitude: 60, wavelength: 260 };
  it("is deterministic and produces one path per line", () => {
    const a = band(opts);
    const b = band(opts);
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    for (const d of a) expect(d).toMatch(/^M-10 [\d.]+( L-?\d+ [\d.]+)+$/);
  });
  it("spans the full width and stays inside the height", () => {
    for (const d of band(opts)) {
      const ys = [...d.matchAll(/ ([\d.]+)(?= L|$)/g)].map((m) => Number(m[1]));
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(400);
      const lastX = Number(d.match(/L(-?\d+) [\d.]+$/)![1]);
      expect(lastX).toBeGreaterThanOrEqual(1200); // the last sample sits at or past the right edge
    }
  });
  it("moves every line with non-zero amplitude when the phase changes", () => {
    const a = band(opts);
    const b = band({ ...opts, phase: 1 });
    a.forEach((d, i) => {
      const flat = i === 0 || i === a.length - 1; // the lens formula leaves the two outer lines straight
      if (flat) expect(d).toEqual(b[i]); else expect(d).not.toEqual(b[i]);
    });
  });
});

describe("GuillocheBand", () => {
  it("renders an aria-hidden svg with a mask and currentColor strokes", () => {
    const html = renderToStaticMarkup(createElement(GuillocheBand, { lines: 5, className: "text-foreground/15" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<mask");
    expect((html.match(/<path /g) ?? []).length).toBe(5);
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain("text-foreground/15");
  });
});
