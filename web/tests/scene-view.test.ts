import { describe, expect, it } from "vitest";
import { bboxScreen, clampView, fitRect, fitView, zoomAt, ZOOM_MAX, ZOOM_MIN } from "@/lib/scene-view";

const box = { w: 1000, h: 600 };
const img = { w: 2000, h: 3000 };  // a portrait page in a landscape bed: height-limited

describe("scene view", () => {
  it("fits the page inside the bed, centred", () => {
    expect(fitView(box, img)).toEqual({ s: 0.2, x: 300, y: 0 });
    expect(fitView({ w: 0, h: 0 }, img)).toEqual({ s: 1, x: 0, y: 0 });
  });
  it("zooms around the pointer and clamps to the fit-relative range", () => {
    const fit = fitView(box, img);
    const z = zoomAt(fit, 2, { x: 500, y: 300 }, box, img);
    expect(z.s).toBeCloseTo(0.4);
    // the page point under the pointer stays under it
    expect((500 - z.x) / z.s).toBeCloseTo((500 - fit.x) / fit.s);
    expect((300 - z.y) / z.s).toBeCloseTo((300 - fit.y) / fit.s);
    expect(zoomAt(fit, 100, { x: 0, y: 0 }, box, img).s).toBeCloseTo(fit.s * ZOOM_MAX);
    expect(zoomAt(fit, 0.001, { x: 0, y: 0 }, box, img).s).toBeCloseTo(fit.s * ZOOM_MIN);
  });
  it("centres a page smaller than the bed and keeps a larger one covering it", () => {
    expect(clampView({ s: 0.1, x: -999, y: 50 }, box, img)).toEqual({ s: 0.1, x: 400, y: 150 });
    expect(clampView({ s: 1, x: 10, y: -5000 }, box, img)).toEqual({ s: 1, x: 0, y: -2400 });
  });
  it("fits a region with a margin", () => {
    const v = fitRect(box, img, [250, 100, 750, 200], 0);
    // region 1000×300 page px into 1000×600: width-limited, s = 1, centred on the region
    expect(v.s).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(-500);
    expect(v.y).toBeCloseTo(-150);
  });
  it("places a bbox on screen", () => {
    expect(bboxScreen([250, 100, 750, 200], img, { s: 0.5, x: 10, y: 20 })).toEqual({ left: 260, top: 170, width: 500, height: 150 });
  });
});
