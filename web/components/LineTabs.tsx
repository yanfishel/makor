"use client";
import { motion } from "motion/react";
import { type ComponentProps, createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Text tabs on one full-width rule with a highlight-coloured indicator that slides between
 * the triggers (a shared `layoutId` per tabs instance). The rule and the indicator are the
 * whole decoration: no box, no pill, no shadow — the "security print" look of the code-block
 * headers. `LineTabs` owns the value (controlled or not) so each trigger knows whether it is
 * the active one; the Radix primitives underneath keep the keyboard/ARIA behaviour.
 */
const Ctx = createContext<{ value: string | undefined; id: string } | null>(null);

export function LineTabs({ value, defaultValue, onValueChange, ...props }: ComponentProps<typeof Tabs>) {
  const [inner, setInner] = useState(defaultValue);
  const id = useId();
  const current = value ?? inner;
  const change = (v: string) => { setInner(v); onValueChange?.(v); };
  return (
    <Ctx.Provider value={{ value: current, id }}>
      <Tabs value={current} onValueChange={change} {...props} />
    </Ctx.Provider>
  );
}

/** A strip wider than its column (the settings tabs on a phone) scrolls sideways in its own
 * wrapper instead of pushing the page. The rule sits on the list, which grows to its content
 * (`w-max`, never narrower than the column), so it runs under every tab while scrolled; the
 * wrapper's bottom padding keeps the indicator's glow inside the clip. */
export function LineTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return (
    <div data-slot="line-tabs-scroller" className="-mb-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <TabsList variant="line" className={cn("h-auto w-max min-w-full justify-start gap-1 rounded-none border-b border-border p-0", className)} {...props} />
    </div>
  );
}

export function LineTab({ value, className, children, ...props }: ComponentProps<typeof TabsTrigger> & { value: string }) {
  const ctx = useContext(Ctx);
  const reduced = useReducedMotion();
  const active = ctx?.value === value;
  const ref = useRef<HTMLButtonElement>(null);
  // An active tab outside a scrolled strip is brought into it — sideways only, so a strip
  // below the fold never scrolls the page. Rect deltas are direction-agnostic (RTL too).
  useEffect(() => {
    const el = ref.current;
    const strip = el?.closest<HTMLElement>('[data-slot="line-tabs-scroller"]');
    if (!active || !el || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const r = el.getBoundingClientRect(), s = strip.getBoundingClientRect();
    const delta = r.left < s.left ? r.left - s.left : r.right > s.right ? r.right - s.right : 0;
    if (delta) strip.scrollBy({ left: delta, behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);
  return (
    <TabsTrigger ref={ref} value={value}
      className={cn("h-auto flex-none rounded-none border-0 px-3 pt-1 pb-2 data-active:bg-transparent dark:data-active:bg-transparent font-mono text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-highlight/40 focus-visible:outline-highlight data-active:text-foreground after:hidden", className)}
      {...props}>
      {children}
      {active && (
        <motion.span aria-hidden data-slot="line-tab-indicator" layoutId={`${ctx?.id ?? "tabs"}-line`}
          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-highlight shadow-[0_0_8px_var(--highlight)]"
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }} />
      )}
    </TabsTrigger>
  );
}

export const LineTabsContent = TabsContent;
