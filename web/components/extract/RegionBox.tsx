"use client";
import { AnimatePresence, motion } from "motion/react";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ScanBeam } from "@/components/ScanBeam";
import { docFamily, isSefachRegion } from "@/lib/doc-types";
import type { RegionState } from "@/lib/extract-stream";
import { regionFrameClass, regionMaskClass, regionTagClass } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

export interface RegionBoxProps {
  region: RegionState;
  rect: { left: number; top: number; width: number; height: number };
  done: boolean;      // the whole page is finished: frames calm down, hover lifts one
  /** The type the page was published as. Once the run is done every read frame is captioned
   * with it (the maintainer's decision of 2026-09-12): a page carries ONE document, and a scene
   * saying "Disability card" beside a result saying "Teudat Zehut" reads as a stale label.
   * What each frame was read as stays in `data-read-as`, and the merge's own disagreement
   * warnings still say which types differed. */
  pageType?: string | null;
  hovered: boolean;
  reduced: boolean;   // prefers-reduced-motion: no beam, no entrance
  onHover: (i: number | null) => void;
  onClick: (i: number) => void;
}

/** One detected region on the scene, in screen pixels (lib/scene-view.ts bboxScreen), in
 * one of six states. The caption is the family once the classifier spoke (tooltip-free:
 * the raw kind is on the ledger), then the page's own type once it is done, plus the dpi
 * when estimated; a read frame counts its fields. */
export function RegionBox({ region, rect, done, pageType = null, hovered, reduced, onHover, onClick }: RegionBoxProps) {
  const t = useTranslations("extract.scene");
  const te = useTranslations("extract");
  const tf = useTranslations("labels.docTypes");
  const { status } = region;
  const readAs = region.docType ?? region.kind;
  // A skipped or unreadable frame is NOT part of the published document, so it keeps its own
  // caption ("skipped" / "unreadable") and never borrows the page's type.
  // The sheet keeps its own name whatever the page was published as: the card beside it is the
  // published document, and two boxes labelled "Teudat Zehut" say nothing about which is which.
  const sheet = isSefachRegion(readAs);
  const family = docFamily(done && pageType && status === "read" && !sheet ? pageType : readAs);
  // The caption's PARTS, never one joined string: "תעודת זהות · 100 dpi" run together is
  // reordered by the bidi algorithm into "100 · תעודת זהות dpi" — the space between the
  // number and "dpi" takes the paragraph's direction and splits the two apart. Each part is
  // isolated below instead, so a Hebrew label and a Latin unit keep their own order.
  const caption =
    status === "skipped" ? [t("skipped")]
    : status === "failed" ? [t("unreadable")]
    : status === "found" ? [`${t("region")} ${region.i + 1}`]
    : [sheet ? te("sefachType") : family ? tf(family) : readAs ?? "", region.dpi ? `${region.dpi} dpi` : ""].filter(Boolean);
  return (
    <motion.div
      data-region={region.i} data-status={status} data-read-as={readAs} role="button" tabIndex={0}
      className={cn("absolute rounded-sm", regionMaskClass(status), done && "cursor-zoom-in", status === "reading" && "overflow-hidden")}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      initial={reduced ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: reduced ? 0 : region.i * 0.12, duration: 0.3 }}
      onPointerEnter={() => onHover(region.i)} onPointerLeave={() => onHover(null)}
      onClick={() => onClick(region.i)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick(region.i);
        else if (e.key === " ") { e.preventDefault(); onClick(region.i); } // native buttons activate on Space; this div does not, and Space must not also scroll the page
      }}>
      {/* The frame alone fades once the page is done — the captions must not. Fading the whole
          box took its labels down with it, and a 55 % caption over a tinted document is
          unreadable exactly where it matters. */}
      <motion.div aria-hidden
        className={cn("pointer-events-none absolute inset-0 rounded-sm transition-colors duration-300", regionFrameClass(status))}
        initial={false} animate={{ opacity: done && !hovered ? 0.55 : 1 }} transition={{ duration: 0.3 }} />
      <AnimatePresence>
        {status === "reading" && !reduced && (
          <ScanBeam key="beam" mode="loop">
            <div className="absolute inset-0 bg-highlight/10 [clip-path:inset(0_0_calc(100%_-_var(--scan)_*_1%)_0)]" />
          </ScanBeam>
        )}
      </AnimatePresence>
      <span className={cn("absolute top-0 start-0 max-w-full truncate rounded-ee-sm px-1 font-mono text-[10px] leading-4", regionTagClass(status))}>
        {caption.map((part, k) => <Fragment key={part}>{k > 0 && <span className="opacity-60"> · </span>}<bdi>{part}</bdi></Fragment>)}
      </span>
      {status === "read" && region.fields && (
        <span className={cn("absolute bottom-0 end-0 rounded-ss-sm px-1 font-mono text-[10px] leading-4", regionTagClass("read"))}><span aria-hidden="true">✓ </span><bdi>{t("fields", { n: region.fields.length })}</bdi></span>
      )}
    </motion.div>
  );
}
