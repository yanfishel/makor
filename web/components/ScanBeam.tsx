"use client";
import { motion } from "motion/react";
import type React from "react";
import type { ReactNode } from "react";

/** The scanner pass: a red laser hairline (the colour of a passport reader's line, the one
 * red on the page) with a soft glow and a faint wash trailing above it. Both ends fade
 * inside the host (horizontal gradients on every layer: a mask on the zero-height wrapper
 * would clip the children). Two strokes like a carriage: down at reading speed and on past
 * the bottom edge — the host clips it (`overflow-hidden`), so it is gone for the dwell —
 * then home faster, fading out near the top so it never parks on an edge. A small white
 * spark darts back and forth along the line on its own, much quicker clock, overshooting
 * and settling at each end (`backOut`, mirrored) like a bead hitting a stop.
 *
 * One clock, the `--scan` variable (0–125, percent of the host's height), drives the beam's
 * `top` and whatever `children` render under it (the hero's "hot" copy of the passport,
 * the scene's tint over the part already read). `once` runs one stroke after `delay`
 * (the hero, remounted per cycle); `loop` repeats until unmounted (the scene, while a
 * frame is being read) and fades out on exit. Never rendered under reduced motion — the
 * callers decide that. */
export const LASER = "oklch(0.62 0.22 27)";
export const SWEEP = { delay: 0.5, down: 2.2, dwell: 0.35, up: 1.2 };
export const SWEEP_TOTAL = SWEEP.down + SWEEP.dwell + SWEEP.up;
/** Keyframe stops for the down / dwell / up legs, as fractions of the whole stroke. */
const SWEEP_TIMES = [0, SWEEP.down / SWEEP_TOTAL, (SWEEP.down + SWEEP.dwell) / SWEEP_TOTAL, 1];
/** Where the carriage dwells: far enough past the edge that the wash above the line is clipped too. */
const BEYOND = 125;
const SCAN_VARS = { "--laser": LASER, "--laser-soft": `color-mix(in oklch, ${LASER} 45%, transparent)` } as React.CSSProperties;

export function ScanBeam({ mode, delay = mode === "once" ? SWEEP.delay : 0, children }: { mode: "once" | "loop"; delay?: number; children?: ReactNode }) {
  const loop = mode === "loop" ? { repeat: Infinity, repeatDelay: 0.3 } : {};
  return (
    <motion.div aria-hidden data-slot="scan" className="pointer-events-none absolute inset-0" style={SCAN_VARS}
      initial={{ "--scan": 0, opacity: 1 } as Record<string, number>} animate={{ "--scan": [0, BEYOND, BEYOND, 0] } as Record<string, number[]>}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      transition={{ delay, duration: SWEEP_TOTAL, times: SWEEP_TIMES, ease: ["easeInOut", "linear", "easeInOut"], ...loop }}>
      {children}
      <motion.div data-slot="scan-beam" className="absolute inset-x-0 h-0 [top:calc(var(--scan)_*_1%)]"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ delay, duration: SWEEP_TOTAL, times: [0, 0.05, 0.92, 1], ease: "linear", ...loop }}>
        <div data-slot="scan-beam-afterglow" className="absolute inset-x-0 bottom-0 h-8 bg-[linear-gradient(to_top,color-mix(in_oklch,var(--laser)_10%,transparent),transparent)] [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]" />
        <div className="absolute inset-x-0 -top-[3px] h-[6px] bg-[linear-gradient(90deg,transparent,var(--laser-soft)_12%,var(--laser-soft)_88%,transparent)] blur-[3px]" />
        <div data-slot="scan-beam-core" className="absolute inset-x-0 -top-px h-px bg-[linear-gradient(90deg,transparent,var(--laser)_12%,var(--laser)_88%,transparent)]">
          <motion.div data-slot="scan-beam-spark" className="absolute inset-y-0 w-[7%] bg-[linear-gradient(90deg,transparent,white,transparent)] shadow-[0_0_3px_1px_rgba(255,255,255,0.7)]"
            initial={{ left: "12%" }} animate={{ left: "80%" }} transition={{ duration: 0.45, ease: "backOut", repeat: Infinity, repeatType: "mirror" }} />
        </div>
      </motion.div>
    </motion.div>
  );
}
