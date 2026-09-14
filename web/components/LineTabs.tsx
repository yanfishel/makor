"use client";
import { motion } from "motion/react";
import { type ComponentProps, createContext, useContext, useId, useState } from "react";
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

export function LineTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return <TabsList variant="line" className={cn("h-auto w-full justify-start gap-1 rounded-none border-b border-border p-0", className)} {...props} />;
}

export function LineTab({ value, className, children, ...props }: ComponentProps<typeof TabsTrigger> & { value: string }) {
  const ctx = useContext(Ctx);
  const reduced = useReducedMotion();
  const active = ctx?.value === value;
  return (
    <TabsTrigger value={value}
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
