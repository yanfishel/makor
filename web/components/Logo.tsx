import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** The M of Makor over three MRZ filler chevrons — the "<" that pads every passport's machine-readable zone.
 * One grid: both rows run x 6.9–17.1 (stroke edges 6–18, centred on 12) at one stroke width; the M's outer box is
 * y 4.5–11.9 and the chevrons' 13.3–19.5 (a 1.4 gap), so the pair sits centred in the tile. Three chevrons, not four: at this
 * width a fourth leaves under a pixel between strokes at 28 px. */
export const MONOGRAM_M = "M6.9 11V5.4l5.1 5.1 5.1-5.1V11";
export const MONOGRAM_CHEVRONS = "M9.1 14.2l-2.2 2.2 2.2 2.2M13.1 14.2l-2.2 2.2 2.2 2.2M17.1 14.2l-2.2 2.2 2.2 2.2";
const STROKE = 1.8;

/** "Makor" in outlines on the lockup's 28 px grid: IBM Plex Sans at wght 600, 19 px, HarfBuzz-shaped with kerning,
 * tracking −0.025em, set 10 px after the 28 px tile with its cap height centred on the tile. Outlines rather than text,
 * so the wordmark is one drawing in the Hebrew locale too (its font stack puts Plex Sans Hebrew's Latin first) and in
 * the static `public/brand/logo-{light,dark}.svg` (served at `/brand/…`, used by the README), which carry this same path. */
export const WORDMARK = "M39.55 20.63V7.37H42.34L44.32 11.14L45.75 13.86H45.8L47.22 11.14L49.19 7.37H51.97V20.63H49.59V13.3V11.2H49.53L48.51 13.22L45.75 18.23L43.04 13.24L42 11.11H41.93V13.3V20.63ZM63.1 20.63H61.75Q61.21 20.63 60.78 20.37Q60.35 20.12 60.12 19.63Q59.88 19.14 59.88 18.47V18.26L60.48 18.93H59.8Q59.55 19.87 58.78 20.37Q58.01 20.86 56.9 20.86Q55.39 20.86 54.57 20.05Q53.75 19.25 53.75 17.94Q53.75 16.91 54.25 16.24Q54.76 15.57 55.7 15.23Q56.65 14.89 58 14.89H59.68V14.16Q59.68 13.35 59.24 12.88Q58.81 12.42 57.83 12.42Q56.98 12.42 56.46 12.79Q55.93 13.16 55.58 13.68L54.14 12.38Q54.68 11.52 55.6 11Q56.51 10.48 58 10.48Q60.01 10.48 61.06 11.4Q62.11 12.32 62.11 14.03V18.7H63.1ZM59.68 16.35H58.12Q57.16 16.35 56.69 16.67Q56.22 16.98 56.22 17.58V17.9Q56.22 18.49 56.61 18.79Q57.01 19.1 57.71 19.1Q58.27 19.1 58.71 18.93Q59.15 18.77 59.41 18.45Q59.68 18.13 59.68 17.66ZM64.59 20.63V6.57H67.03V13.04V15.05H67.13L68.44 13.26L70.67 10.71H73.41L69.99 14.54L73.78 20.63H70.88L68.34 16.18L67.03 17.62V20.63ZM78.29 20.86Q76.87 20.86 75.84 20.22Q74.81 19.59 74.25 18.42Q73.69 17.25 73.69 15.66Q73.69 14.06 74.25 12.91Q74.81 11.75 75.84 11.11Q76.87 10.48 78.29 10.48Q79.71 10.48 80.74 11.11Q81.77 11.75 82.33 12.91Q82.89 14.06 82.89 15.66Q82.89 17.25 82.33 18.42Q81.77 19.59 80.74 20.22Q79.71 20.86 78.29 20.86ZM78.29 18.89Q79.24 18.89 79.79 18.3Q80.34 17.71 80.34 16.59V14.74Q80.34 13.62 79.79 13.03Q79.24 12.44 78.29 12.44Q77.35 12.44 76.79 13.03Q76.23 13.62 76.23 14.74V16.59Q76.23 17.71 76.79 18.3Q77.35 18.89 78.29 18.89ZM86.99 20.63H84.56V10.71H86.99V12.77H87.09Q87.22 12.24 87.54 11.77Q87.86 11.3 88.4 11Q88.94 10.71 89.72 10.71H90.24V13H89.48Q88.67 13 88.11 13.17Q87.55 13.33 87.27 13.67Q86.99 14 86.99 14.56Z";
/** The lockup's width on the same grid: tile, gap and the wordmark's advance. */
export const LOCKUP_WIDTH = 91;

/** The tile flips with the theme on paper (ink tile in light, paper tile in dark) and stays light on the ink sidebar;
 * the chevrons take the teal that holds contrast on that tile, the wordmark the surface's own text colour. */
const TONE = {
  default: "text-primary [--glyph:var(--primary-foreground)] [--glyph-accent:var(--mark-accent-on-ink)] dark:[--glyph-accent:var(--mark-accent-on-paper)] [--wordmark:var(--foreground)]",
  ink: "text-sidebar-foreground [--glyph:var(--sidebar)] [--glyph-accent:var(--mark-accent-on-paper)] [--wordmark:var(--sidebar-foreground)]",
} as const;
type Tone = keyof typeof TONE;

/** The tile and its monogram on the 24-unit icon grid; `app/icon.svg` is the same drawing. */
function Monogram({ scale }: { scale?: number }) {
  return (
    <g transform={scale ? `scale(${scale})` : undefined}>
      <rect x="1" y="1" width="22" height="22" rx="5" fill="currentColor" />
      <path d={MONOGRAM_M} stroke="var(--glyph)" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <path d={MONOGRAM_CHEVRONS} stroke="var(--glyph-accent)" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** The bare mark. The tile is `currentColor` and the strokes read `--glyph` / `--glyph-accent`: the caller sets them. */
export function LogoMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none"><Monogram /></svg>;
}

/**
 * The lockup: mark and wordmark in one LTR drawing, so the mark stays before the word in the Hebrew layout as well.
 * `collapsible` follows an icon-collapsible sidebar on its own 200 ms linear transition — the frame narrows to the tile
 * and the wordmark fades — instead of the drawing being swapped the moment the state flips.
 */
export function Logo({ className, tone = "default", collapsible = false }: { className?: string; tone?: Tone; collapsible?: boolean }) {
  return (
    <span dir="ltr" style={collapsible ? ({ "--lockup": `${LOCKUP_WIDTH}px` } as CSSProperties) : undefined}
      className={cn("inline-flex h-7 shrink-0 overflow-hidden", collapsible && "w-(--lockup) transition-[width] duration-200 ease-linear group-data-[collapsible=icon]:w-7", className)}>
      <svg viewBox={`0 0 ${LOCKUP_WIDTH} 28`} width={LOCKUP_WIDTH} height={28} className={cn("shrink-0", TONE[tone])} role="img" aria-label="Makor" fill="none">
        <Monogram scale={28 / 24} />
        <path d={WORDMARK} fill="var(--wordmark)" className={collapsible ? "transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0" : undefined} />
      </svg>
    </span>
  );
}
