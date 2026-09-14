import { useId } from "react";
import { band, type BandOptions } from "@/lib/guilloche";
import { cn } from "@/lib/utils";

export type GuillocheBandProps = Partial<BandOptions> & { className?: string; opacity?: number };

/** The wave band as a decorative SVG: fades out at both ends, strokes in `currentColor`
 * so the parent's text colour (e.g. `text-foreground/15`) sets the ink. */
export function GuillocheBand({ width = 1200, height = 400, className, opacity = 1, ...opts }: GuillocheBandProps) {
  const id = useId().replace(/\W/g, "");
  const paths = band({ width, height, ...opts });
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.8" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`m${id}`}><rect width="100%" height="100%" fill={`url(#g${id})`} /></mask>
      </defs>
      <g mask={`url(#m${id})`} opacity={opacity}>
        {paths.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="0.55" vectorEffect="non-scaling-stroke" />)}
      </g>
    </svg>
  );
}
