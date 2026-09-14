import { GuillocheBand } from "@/components/Guilloche";
import { ParallaxX } from "./HeroFan";

export type HeroBackdropVariant = "band" | "halo";

/** A soft teal glow behind the fan; the fan sits at the row's end, so the glow does too. */
function Halo() {
  return <div aria-hidden className="absolute inset-y-0 end-0 w-2/3" style={{ background: "radial-gradient(60% 55% at 55% 50%, color-mix(in oklch, var(--highlight) 18%, transparent), transparent 70%)" }} />;
}

/** Paper grain for the halo variant: SVG turbulence, no image asset. */
function Grain() {
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full opacity-[0.06] dark:opacity-[0.09]">
      <filter id="hero-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" /></filter>
      <rect width="100%" height="100%" filter="url(#hero-grain)" />
    </svg>
  );
}

/** Fills the hero section, which is full width (its content sits in a `Container`). */
export function HeroBackdrop({ variant }: { variant: HeroBackdropVariant }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <Halo />
      {variant === "band"
        ? <ParallaxX distance={-80}>
            {/* The band draws with preserveAspectRatio="none": pinned to its own 420 px height it
                keeps the designed wave. Below `lg` the hero is one narrow column, where the same
                viewBox squeezes the waves into spikes behind the text — there the halo carries it. */}
            <div className="absolute inset-x-0 top-1/2 hidden h-[420px] -translate-y-1/2 lg:block">
              <GuillocheBand className="text-foreground/[0.14] dark:text-foreground/[0.18]" y={0.62} lines={34} amplitude={150} wavelength={260} />
            </div>
          </ParallaxX>
        : <Grain />}
    </div>
  );
}
