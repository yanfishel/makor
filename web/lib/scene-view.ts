import type { Bbox } from "@/lib/extract-stream";

/** Pure geometry of the scanner bed: where the page sits on screen and at what scale.
 * Boxes are drawn in SCREEN space from these numbers (not inside a CSS-scaled layer), so
 * strokes, captions and the beam keep their pixel size at every zoom. */
export interface Size { w: number; h: number }
export interface View { x: number; y: number; s: number }
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

export function fitView(box: Size, img: Size): View {
  if (!box.w || !box.h || !img.w || !img.h) return { s: 1, x: 0, y: 0 };
  const s = Math.min(box.w / img.w, box.h / img.h);
  return { s, x: (box.w - img.w * s) / 2, y: (box.h - img.h * s) / 2 };
}

/** A page smaller than the bed on an axis is centred on it; a larger one may never leave a gap. */
export function clampView(v: View, box: Size, img: Size): View {
  const w = img.w * v.s, h = img.h * v.s;
  return {
    s: v.s,
    x: w <= box.w ? (box.w - w) / 2 : Math.min(0, Math.max(box.w - w, v.x)),
    y: h <= box.h ? (box.h - h) / 2 : Math.min(0, Math.max(box.h - h, v.y)),
  };
}

function clampScale(s: number, box: Size, img: Size): number {
  const fit = fitView(box, img).s;
  return Math.min(fit * ZOOM_MAX, Math.max(fit * ZOOM_MIN, s));
}

/** Scale by `factor` keeping the page point under `at` (bed coordinates) where it is. */
export function zoomAt(v: View, factor: number, at: { x: number; y: number }, box: Size, img: Size): View {
  const s = clampScale(v.s * factor, box, img);
  const k = s / v.s;
  return clampView({ s, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, box, img);
}

/** The view that shows one region (0–1000 bbox) with `margin` of its size around it. */
export function fitRect(box: Size, img: Size, bbox: Bbox, margin = 0.06): View {
  const [x1, y1, x2, y2] = bbox.map((n) => n / 1000);
  const rw = (x2 - x1) * img.w, rh = (y2 - y1) * img.h;
  const s = clampScale(Math.min(box.w / (rw * (1 + 2 * margin)), box.h / (rh * (1 + 2 * margin))), box, img);
  return clampView({ s, x: box.w / 2 - (x1 * img.w + rw / 2) * s, y: box.h / 2 - (y1 * img.h + rh / 2) * s }, box, img);
}

export function bboxScreen(bbox: Bbox, img: Size, v: View): { left: number; top: number; width: number; height: number } {
  const [x1, y1, x2, y2] = bbox;
  return { left: v.x + (x1 / 1000) * img.w * v.s, top: v.y + (y1 / 1000) * img.h * v.s, width: ((x2 - x1) / 1000) * img.w * v.s, height: ((y2 - y1) / 1000) * img.h * v.s };
}
