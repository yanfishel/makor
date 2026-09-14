export interface BandOptions {
  width: number;
  height: number;
  /** Vertical centre of the band as a fraction of height (0–1). Default 0.62. */
  y?: number;
  lines?: number;
  /** Peak amplitude in px of the middle line; the outer lines flatten out (a lens). */
  amplitude?: number;
  wavelength?: number;
  /** Phase offset in radians; the scroll parallax animates it. */
  phase?: number;
}

const STEP = 6;

/** A security-print wave band: line i is y = y0 + i·gap + A(i)·sin(2πx/λ + i·Δφ + phase)
 * plus a second harmonic at a third of the amplitude. Pure and deterministic. */
export function band({ width, height, y = 0.62, lines = 34, amplitude = 120, wavelength = 260, phase = 0 }: BandOptions): string[] {
  const y0 = height * y;
  const span = amplitude * 0.64;
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const t = lines === 1 ? 0.5 : i / (lines - 1);
    const A = amplitude * 0.5 * Math.sin(Math.PI * t);
    const yb = y0 - span / 2 + t * span;
    let d = "";
    for (let x = -10; x <= width + 10 + STEP; x += STEP) {
      const w = (2 * Math.PI * x) / wavelength;
      const yy = yb + A * Math.sin(w + i * 0.28 + phase) + A * 0.3 * Math.sin(w * 2.9 - i * 0.2 + phase);
      const clamped = Math.min(height, Math.max(0, yy));
      d += (x === -10 ? "M" : " L") + x + " " + clamped.toFixed(1);
    }
    out.push(d);
  }
  return out;
}
