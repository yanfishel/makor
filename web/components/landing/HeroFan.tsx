"use client";
import { CheckCircle2 } from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { createContext, type PointerEvent, type ReactNode, useContext, useEffect, useState } from "react";
import { ScanBeam, SWEEP } from "@/components/ScanBeam";
import { StatusBadge } from "@/components/StatusBadge";
import { useDirection } from "@/components/ui/direction";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

/** Slides its child horizontally with the page scroll (the band's phase drift). */
export function ParallaxX({ distance, children }: { distance: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  const x = useTransform(scrollY, [0, 600], [0, distance]);
  return <motion.div className="absolute inset-0" style={reduced ? undefined : { x }}>{children}</motion.div>;
}

const CARD = "absolute w-[290px] overflow-hidden rounded-lg p-4 text-[11px] leading-snug shadow-[0_30px_60px_-20px_color-mix(in_oklch,var(--ink)_45%,transparent)] ring-1 ring-foreground/10 text-ink";
const FIELDS = [["passport_number", "12345678", "high"], ["id_number", "123456782", "high"], ["date_of_birth", "1990-01-01", "high"], ["expiry_date", "2030-01-01", "medium"]] as const;

/** Three synthetic documents; the passport on top carries the scanner beam. `rest.z` is what
 * orders them: inside `transform-style: preserve-3d` the browser sorts siblings by their plane,
 * not by DOM order, so equal-z cards intersect instead of stacking. */
const CARDS = [
  { key: "cheque", bg: "bg-[#e6f2ee]", rest: { x: 0, y: 66, z: 0, rotate: -8, rotateY: -18 }, body: (
    <><Head a="CHEQUE · BANK 11" b="148" /><Rows rows={[["Pay to", "—"], ["Amount", "4,500.00"], ["Date", "2026-09-07"]] as const} /><Mrz text="⑈80001234⑈ 11 14841 ⑆ 0000123456" /></>) },
  { key: "card", bg: "bg-[#dbe8f6]", rest: { x: 30, y: 36, z: 26, rotate: -3, rotateY: -12 }, body: (
    <><Head a="תעודת זהות · ISRAEL" b="TD1" /><Rows rows={[["שם משפחה", "ישראלי"], ["שם פרטי", "ישראל"], ["מספר זהות", "1 2345678 2"]] as const} /><Mrz text="I<ISR123456782<<<<<<<<<<<<<<<" /></>) },
  { key: "passport", bg: "bg-white", rest: { x: 70, y: 6, z: 52, rotate: 3, rotateY: -6 }, body: (
    <><Head a="PASSPORT · ISR" b="P" /><Rows rows={[["Surname", "ISRAELI"], ["Given name", "ISRAEL"], ["Passport No.", "12345678"], ["Date of birth", "01 JAN 1990"]] as const} /><Mrz text="P<ISRISRAELI<<ISRAEL<<<<<<<<<<<<<<<<<<" /></>) },
];

function Head({ a, b }: { a: string; b: string }) { return <div className="mb-2 flex justify-between font-mono text-[10px] font-semibold tracking-[0.12em] opacity-70"><span>{a}</span><span>{b}</span></div>; }
/** True inside the scan overlay: values render "recognised" — a highlight marker behind them.
 * Background and box-shadow only, so the overlay's text sits pixel-exactly over the card's. */
const Hot = createContext(false);
const HOT = "rounded-[2px] bg-highlight/20 shadow-[0_0_0_2px_color-mix(in_oklch,var(--highlight)_20%,transparent)] text-highlight";
function Rows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  const hot = useContext(Hot);
  return <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">{rows.map(([k, v]) => <div key={k} className="contents"><dt className="opacity-55">{k}</dt><dd className="text-end"><span className={cn(hot && HOT)}>{v}</span></dd></div>)}</dl>;
}
function Mrz({ text }: { text: string }) {
  const hot = useContext(Hot);
  return <p className="mt-2 truncate font-mono text-[10px] tracking-[0.14em] opacity-80"><span className={cn(hot && HOT)}>{text}</span></p>;
}

/** The scanner pass over the passport (components/ScanBeam.tsx) with a second copy of the
 * card body rendered "hot" (`Hot`) and clipped to the part above the beam, so the values
 * light up as the line passes on the way down and go out again as it passes on the way
 * up. Remounted per cycle (`key`), never rendered under reduced motion. */
/** When the result chips may start: the reading stroke (delay + down) is done and the
 * carriage is on its way home, so the values it lit up on the way down can stay lit. */
export const SCAN_READ_DONE = SWEEP.delay + SWEEP.down;
function Scan({ body }: { body: ReactNode }) {
  return (
    <ScanBeam mode="once">
      <div data-slot="scan-overlay" className="absolute inset-0 p-4 [clip-path:inset(0_0_calc(100%_-_var(--scan)_*_1%)_0)]">
        <Hot.Provider value={true}>{body}</Hot.Provider>
      </div>
    </ScanBeam>
  );
}

export function HeroFan({ label }: { label: string }) {
  const reduced = useReducedMotion();
  const dir = useDirection();
  const sign = dir === "rtl" ? -1 : 1;
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setCycle((c) => c + 1), 12000);
    return () => clearInterval(id);
  }, [reduced]);

  // Pointer tilt is fine-pointer only; read via matchMedia once on mount rather than on every
  // render (false until mounted, which is also what the server renders).
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(pointer: fine)");
    const sync = () => setFine(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, []);

  // Scroll: the fan leans back (rotateX 0 → 28° over the first 500 px) and slides away from
  // the ledger, the front card fastest (0 / −28 / −56 px by depth) — motion without vertical
  // displacement and away from the chips, so nothing ever drifts over them. A vertical parallax did exactly that: the cards lagged the page while the
  // chips scrolled with it, and the passport ended up on top of the results.
  const { scrollY } = useScroll();
  const lean = useTransform(scrollY, [0, 500], [0, 28]);
  const spreads = [useMotionValue(0), useTransform(scrollY, [0, 500], [0, -28]), useTransform(scrollY, [0, 500], [0, -56])];

  // Pointer tilt (fine pointers only): ±4° through a spring, on top of the scroll lean.
  const rx = useSpring(useMotionValue(0), { stiffness: 120, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 120, damping: 18 });
  const rotateX = useTransform(() => rx.get() + lean.get());
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || !fine) return;
    const r = e.currentTarget.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 8);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 8);
  };
  const onLeave = () => { rx.set(0); ry.set(0); };

  const t = (delay: number, duration = 0.4) => (reduced ? { duration: 0 } : { delay, duration });
  // One height everywhere: on a phone the ledger overlaps the cards' lower corner, which reads
  // fine (it is the front layer) and beats a taller figure with a hole in the middle.
  return (
    <div role="img" aria-label={label} dir="ltr" className="relative h-[300px] select-none [perspective:1200px]" onPointerMove={onMove} onPointerLeave={onLeave}>
      <motion.div className="absolute inset-0 [transform-style:preserve-3d]" style={reduced ? undefined : { rotateX, rotateY: ry }}>
        {CARDS.map((c, i) => (
          <motion.div key={c.key} className={cn(CARD, c.bg)}
            initial={reduced ? false : { opacity: 0, x: 40, y: 40, z: c.rest.z, rotate: 0, rotateY: 0 }}
            animate={{ opacity: 1, x: c.rest.x, y: c.rest.y, z: c.rest.z, rotate: c.rest.rotate, rotateY: c.rest.rotateY * sign, rotateX: 4 }}
            transition={t(i * 0.08, 0.6)}
            style={reduced ? undefined : { marginLeft: spreads[i] }}>
            {c.body}
            {c.key === "passport" && !reduced && <Scan key={cycle} body={c.body} />}
          </motion.div>
        ))}
      </motion.div>
      {/* lang="en": Next's CSS pipeline (Lightning CSS) transpiles logical properties (-end-2,
          ms-auto) into physical sides gated by `:lang()`, not `dir`, so this LTR island has to
          declare an LTR language too or the ledger jumps to the other side on /he. The chips are
          English field names. */}
      {/* AnimatePresence lets the previous cycle's ledger slide out (top row first) while the new
          one is already mounted and waiting for its scan; the two overlap for the 0.4 s exit. No
          `initial={false}` here: it would also skip the chips' own mount animation on first load,
          showing the ledger before the first scan. */}
      <AnimatePresence>
        <div key={cycle} lang="en" className="absolute -end-2 bottom-0 grid gap-1.5">
          {FIELDS.map(([name, value, conf], i) => (
            <motion.div key={name} className="flex items-center gap-2 rounded-sm border bg-card px-2 py-1 text-[11px]"
              initial={reduced ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={t(SCAN_READ_DONE + 0.2 + i * 0.18)}
              exit={{ opacity: 0, x: 12, transition: reduced ? { duration: 0 } : { delay: i * 0.06, duration: 0.3 } }}>
              <span className="font-mono text-muted-foreground">{name}</span><span className="ms-auto font-mono">{value}</span><StatusBadge value={conf} className="h-4 px-1.5 text-[10px]" />
            </motion.div>
          ))}
          <motion.div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-success" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={t(SCAN_READ_DONE + 1.1)}
            exit={{ opacity: 0, transition: reduced ? { duration: 0 } : { duration: 0.25 } }}>
            <CheckCircle2 className="size-4" />verified
          </motion.div>
        </div>
      </AnimatePresence>
    </div>
  );
}
