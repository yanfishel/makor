"use client";
import { FileText, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { RegionBox } from "@/components/extract/RegionBox";
import { ScanBeam } from "@/components/ScanBeam";
import { Button } from "@/components/ui/button";
import type { ExtractState } from "@/lib/extract-stream";
import { formatFileSize } from "@/lib/format";
import { bboxScreen, clampView, fitRect, fitView, zoomAt, type Size, type View } from "@/lib/scene-view";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

export interface DocumentSceneProps {
  src: string | null;        // the image to show: the PDF preview from the `page` event, or the upload's object URL
  /** The upload behind the preview; named on the toolbar beside the page's pixel size. */
  file?: { name: string; size: number } | null;
  state: ExtractState;
  hoverIndex: number | null;
  onHover: (i: number | null) => void;
  /** How the page makes the bed fill its column — see ExtractWorkbench for why the column,
   * not the bed, is what the window height is measured against. */
  className?: string;
}

const DRAG_SLOP = 4;

/** The scanner unit: a control strip (what is on the bed, at what scale) over the bed itself —
 * the page on `ink`, zoomable and pannable, with the regions drawn over it
 * in screen pixels. An LTR island (coordinates and mono captions) like the hero. Zoom:
 * Ctrl/⌘ + wheel or a trackpad pinch (the same wheel event with ctrlKey), a two-finger
 * pinch on touch, the toolbar, `+ − 0` while focused, a double-click (fit ↔ 100 %), and a
 * click on a region (fit that region). A plain wheel scrolls the page. Fit is recomputed
 * on resize until the user has zoomed. */
export function DocumentScene({ src, file = null, state, hoverIndex, onHover, className }: DocumentSceneProps) {
  const t = useTranslations("extract.scene");
  const ta = useTranslations("extract");
  const reduced = useReducedMotion();
  const bed = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [img, setImg] = useState<Size>({ w: state.page?.width ?? 0, h: state.page?.height ?? 0 });
  const [view, setView] = useState<View | null>(null);  // null = fit
  const fit = fitView(box, img);
  const v = view ?? fit;
  const done = state.stage === "done";

  useEffect(() => { if (state.page) setImg({ w: state.page.width, h: state.page.height }); }, [state.page]);
  useEffect(() => {
    const el = bed.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A resize (window, sidebar toggle, responsive breakpoint) changes `box` while a stored
  // `view`'s x/y/s stay whatever they were clamped to against the OLD box — left unclamped,
  // the page could sit outside the new bed. Every path that changes the view must leave the
  // page inside it, so re-clamp here too, not only at the point of the gesture that set it.
  useEffect(() => {
    setView((cur) => (cur ? clampView(cur, box, img) : cur));
  }, [box, img]);
  // React's onWheel is passive: preventDefault (to stop the browser zooming the page) needs a native listener.
  useEffect(() => {
    const el = bed.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((cur) => zoomAt(cur ?? fitView(box, img), Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top }, box, img));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [box, img]);

  // Pointers: one drags, two pinch. A press that moves less than DRAG_SLOP is a click (region boxes handle their own).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; dist: number; mid: { x: number; y: number } } | null>(null);
  const dragged = useRef(false);
  const local = (e: ReactPointerEvent) => { const r = bed.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  // Capturing on pointerdown retargets pointerup AND click onto the bed, so a click on a region
  // box never reached it and click-to-zoom did nothing. Capture is only needed to keep a gesture
  // alive past the bed's edge, which cannot happen before the pointer has moved.
  const startDrag = (e: ReactPointerEvent) => {
    dragged.current = true;
    if (bed.current && !bed.current.hasPointerCapture(e.pointerId)) bed.current.setPointerCapture(e.pointerId);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    pointers.current.set(e.pointerId, local(e));
    dragged.current = false;
    const pts = [...pointers.current.values()];
    gesture.current = { view: v, dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, mid: pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0] };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const scaled = zoomAt(g.view, g.dist ? dist / g.dist : 1, g.mid, box, img);
      setView(clampView({ ...scaled, x: scaled.x + mid.x - g.mid.x, y: scaled.y + mid.y - g.mid.y }, box, img));
      startDrag(e);
    } else {
      const dx = pts[0].x - g.mid.x, dy = pts[0].y - g.mid.y;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) startDrag(e);
      if (dragged.current) setView(clampView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy }, box, img));
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
  };
  const zoomBy = useCallback((factor: number) => setView((cur) => zoomAt(cur ?? fitView(box, img), factor, { x: box.w / 2, y: box.h / 2 }, box, img)), [box, img]);
  const actual = () => setView(clampView({ s: 1, x: box.w / 2 - img.w / 2, y: box.h / 2 - img.h / 2 }, box, img));
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else if (e.key === "0") setView(null);
    else return;
    e.preventDefault();
  };
  const onRegionClick = (i: number) => {
    if (dragged.current) return;
    const r = state.regions.find((x) => x.i === i);
    if (r) setView(fitRect(box, img, r.bbox));
  };

  const ready = Boolean(src) && img.w > 0 && img.h > 0;
  const atActual = Boolean(view) && Math.abs(v.s - 1) < 1e-6;
  // Two segmented controls, each a raised key on the strip: on `ink` a ghost button reads as a
  // caption, so every key carries its own face (a lighter fill, a hairline between the keys of a
  // group) and takes the strip's own hover — the page's light `accent` hover would flash white
  // here. A pressed mode key is filled and teal.
  // The keys carry the group's own radius on its outer corners (6 px of the group less its 1 px
  // border) instead of being clipped by it: a square key under a rounded, overflow-hidden group
  // shows its corner and a hairline gap at every corner.
  const group = "flex items-center divide-x divide-ink-foreground/12 rounded-md border border-ink-foreground/12 bg-ink-foreground/10 [&>:first-child]:rounded-s-[5px] [&>:last-child]:rounded-e-[5px]";
  const key = "h-7 rounded-none px-2.5 font-mono text-xs font-medium text-ink-foreground/80 hover:bg-ink-foreground/20 hover:text-ink-foreground";
  const on = "bg-highlight/20 text-highlight hover:bg-highlight/25 hover:text-highlight";
  return (
    <div data-slot="scene" dir="ltr" lang="en"
      className={cn("flex min-h-[55vh] flex-col overflow-hidden rounded-md bg-ink text-ink-foreground lg:min-h-[240px]", className)}>
      {/* What is on the bed, and at what scale — the two questions the picture cannot answer itself. */}
      <div data-slot="scene-toolbar" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-foreground/15 bg-ink-foreground/5 px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-2.5">
          <FileText className="size-3.5 shrink-0 text-ink-foreground/45" aria-hidden />
          {file && <span className="truncate font-mono text-ink-foreground/90">{file.name}</span>}
          {file && <Rule />}
          {file && <span className="shrink-0 font-mono tabular-nums text-ink-foreground/55">{formatFileSize(file.size)}</span>}
          {state.page && <Rule />}
          {state.page && <span className="shrink-0 font-mono tabular-nums text-ink-foreground/55">{state.page.width} × {state.page.height}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={group}>
            <Button type="button" variant="ghost" size="sm" aria-pressed={!view} className={cn(key, !view && on)} onClick={() => setView(null)}>{t("fit")}</Button>
            <Button type="button" variant="ghost" size="sm" aria-pressed={atActual} className={cn(key, atActual && on)} onClick={actual}>{t("actual")}</Button>
          </div>
          <div className={group}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("zoomOut")} className={cn(key, "size-7 px-0")} onClick={() => zoomBy(0.8)}><Minus /></Button>
            {/* The true scale, not a percentage of fit: the "100%" key beside it means the same 100.
                Sunken (no fill) so the two keys around it read as the pressable halves. */}
            <span data-slot="scene-zoom" className="w-14 bg-ink/60 py-1 text-center font-mono tabular-nums text-ink-foreground/75">{Math.round(v.s * 100)}%</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("zoomIn")} className={cn(key, "size-7 px-0")} onClick={() => zoomBy(1.25)}><Plus /></Button>
          </div>
        </div>
      </div>
      <div ref={bed} tabIndex={0} aria-label={ta("regions")}
        className="relative min-h-0 flex-1 select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-highlight"
        style={{ touchAction: "none", cursor: dragged.current ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={() => (view && Math.abs(view.s - fit.s) > 1e-6 ? setView(null) : actual())} onKeyDown={onKeyDown}>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element -- blob:/data: preview, next/image gains nothing
          <img src={src} alt="" draggable={false}
            onLoad={(e) => { if (!state.page) setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); }}
            className={cn("absolute left-0 top-0 max-w-none shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]", !ready && "invisible")}
            style={{ width: img.w || undefined, height: img.h || undefined, transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})`, transformOrigin: "0 0" }} />
        )}
        {!ready && <p className="absolute inset-0 flex items-center justify-center font-mono text-xs text-ink-foreground/70">{t("waiting")}</p>}
        {ready && state.regions.map((r) => (
          <RegionBox key={r.i} region={r} rect={bboxScreen(r.bbox, img, v)} done={done} pageType={state.result?.document_type ?? null}
            hovered={hoverIndex === r.i} reduced={reduced} onHover={onHover} onClick={onRegionClick} />
        ))}
        {ready && state.whole?.status === "reading" && !reduced && (
          <div className="pointer-events-none absolute overflow-hidden" style={bboxScreen([0, 0, 1000, 1000], img, v)}>
            {/* the whole page is the frame: the beam runs over all of it, nothing to dim */}
            <ScanBeam mode="loop" />
          </div>
        )}
      </div>
    </div>
  );
}

/** The toolbar's hairline between two readings — a rule, not a bullet: this is an instrument. */
const Rule = () => <span aria-hidden className="h-3 w-px shrink-0 bg-ink-foreground/20" />;
