import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanBeam } from "@/components/ScanBeam";

describe("ScanBeam", () => {
  it("renders the beam layers and its children under the scan clock", () => {
    const html = renderToStaticMarkup(createElement(ScanBeam, { mode: "loop" }, createElement("i", { id: "hot" })));
    expect(html).toContain('data-slot="scan"');
    for (const slot of ["scan-beam", "scan-beam-afterglow", "scan-beam-core", "scan-beam-spark"]) expect(html).toContain(`data-slot="${slot}"`);
    expect(html.indexOf('id="hot"')).toBeLessThan(html.indexOf('data-slot="scan-beam"'));  // children sit under the beam
    expect(html).toContain("--laser");
  });
});
