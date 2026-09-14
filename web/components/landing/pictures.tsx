"use client";
import { motion } from "motion/react";
import type { ComponentProps } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/** A foreground stroke that draws itself once when scrolled into view. */
function Draw({ delay = 0, ...props }: ComponentProps<typeof motion.path> & { delay?: number }) {
  const reduced = useReducedMotion();
  return <motion.path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    initial={reduced ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: reduced ? 0 : 0.7, delay: reduced ? 0 : delay }} {...props} />;
}

/** The second tone: a highlight fill that fades in after the strokes. */
function Fill({ delay = 0.5, ...props }: ComponentProps<typeof motion.path> & { delay?: number }) {
  const reduced = useReducedMotion();
  return <motion.path fill="var(--highlight)" fillOpacity=".18" stroke="none"
    initial={reduced ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : delay }} {...props} />;
}

const ICON = { viewBox: "0 0 64 64", fill: "none", className: "size-20 text-foreground", "aria-hidden": true as const };
const ACCENT = { stroke: "var(--highlight)", strokeWidth: "2.25" };

/** Duotone step icons — foreground strokes, highlight for what the code adds. */
export function StepPicture({ step }: { step: 0 | 1 | 2 | 3 }) {
  switch (step) {
    // Detect: the page, the card found on it (tone 2), the detector's viewfinder brackets (accent).
    case 0: return (
      <svg {...ICON} data-step="0">
        <Draw d="M14 8h36a2 2 0 0 1 2 2v44a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
        <Fill d="M21 25h22a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 43 41H21a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 21 25z" />
        <Draw delay={0.6} d="M15 27v-6h6M49 27v-6h-6M15 39v6h6M49 39v6h-6" {...ACCENT} />
      </svg>);
    // Crop at full resolution: the crop tool, the kept area (tone 2) with its readable print.
    case 1: return (
      <svg {...ICON} data-step="1">
        <Fill d="M18 18h28v28H18z" />
        <Draw d="M18 6v40h40" /><Draw delay={0.15} d="M6 18h40v40" />
        <Draw delay={0.6} d="M25 27h14M25 33h10M25 39h12" {...ACCENT} strokeWidth="2" />
      </svg>);
    // Extract: the JSON braces, the fields inside them (accent bars).
    case 2: return (
      <svg {...ICON} data-step="2">
        <Fill d="M24 8h16a2 2 0 0 1 2 2v44a2 2 0 0 1-2 2H24a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" delay={0.3} />
        <Draw d="M22 8c-5 0-8 2-8 7v9c0 4-2 7-6 8 4 1 6 4 6 8v9c0 5 3 7 8 7" />
        <Draw delay={0.15} d="M42 8c5 0 8 2 8 7v9c0 4 2 7 6 8-4 1-6 4-6 8v9c0 5-3 7-8 7" />
        <Draw delay={0.6} d="M26 24h12M26 32h8M26 40h11" {...ACCENT} />
      </svg>);
    // Validate locally: the shield (tone 2 inside) and the check that the math draws.
    default: return (
      <svg {...ICON} data-step="3">
        <Fill d="M32 7l20 7v15c0 12-8 22-20 28C20 51 12 41 12 29V14z" />
        <Draw d="M32 7l20 7v15c0 12-8 22-20 28C20 51 12 41 12 29V14z" />
        <Draw delay={0.7} d="M22 31l7 7 13-14" {...ACCENT} strokeWidth="2.75" />
      </svg>);
  }
}
