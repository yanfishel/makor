"use client";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

/** `sub`: a subsection, indented under the section above it. */
export interface TocItem { id: string; label: string; sub?: boolean }

/**
 * The docs page's spy menu: one vertical rule with a highlight indicator that slides to the
 * section under the reader (the LineTabs look, turned on its side). Active = the last heading
 * whose top has passed the upper part of the viewport, via IntersectionObserver.
 */
export function DocsToc({ items, title, className }: { items: TocItem[]; title: string; className?: string }) {
  const [active, setActive] = useState(items[0]?.id);
  const reduced = useReducedMotion();
  useEffect(() => {
    const headings = items.map((it) => document.getElementById(it.id)).filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const pick = () => {
      const line = window.innerHeight * 0.25;
      let current = headings[0].id;
      for (const h of headings) if (h.getBoundingClientRect().top <= line) current = h.id;
      setActive(current);
    };
    const observer = new IntersectionObserver(pick, { rootMargin: "-25% 0px -60% 0px", threshold: [0, 1] });
    headings.forEach((h) => observer.observe(h));
    window.addEventListener("scroll", pick, { passive: true });
    pick();
    return () => { observer.disconnect(); window.removeEventListener("scroll", pick); };
  }, [items]);
  return (
    <nav aria-label={title} className={cn("text-sm", className)}>
      <p className="mb-3 font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="relative border-s border-border">
        {items.map((it) => {
          const isActive = it.id === active;
          return (
            <li key={it.id} className="relative">
              {isActive && (
                <motion.span aria-hidden layoutId="docs-toc-indicator" className="absolute -start-px top-0 h-full w-0.5 rounded-full bg-highlight shadow-[0_0_8px_var(--highlight)]"
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }} />
              )}
              <a href={`#${it.id}`} aria-current={isActive ? "location" : undefined}
                className={cn("block py-1.5 font-mono text-[13px] transition-colors hover:text-foreground", it.sub ? "ps-7" : "ps-4", isActive ? "text-foreground" : "text-muted-foreground")}>
                {it.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
