import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocSilhouette, SILHOUETTE_TYPES, silhouetteType } from "@/components/DocSilhouette";

describe("DocSilhouette", () => {
  it("draws every type as an aria-hidden svg", () => {
    for (const t of SILHOUETTE_TYPES) {
      const html = renderToStaticMarkup(createElement(DocSilhouette, { type: t, className: "h-8" }));
      expect(html).toContain("<svg");
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("h-8");
    }
  });
  it("maps document types onto the five silhouettes", () => {
    expect(silhouetteType("teudat_zehut_sefach")).toBe("teudat_zehut");
    expect(silhouetteType("cheque_back")).toBe("cheque");
    expect(silhouetteType("unreadable")).toBe("other");
    expect(silhouetteType(null)).toBe("other");
  });
});
