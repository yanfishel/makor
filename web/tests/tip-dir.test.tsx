import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

/* Radix mounts the tooltip content only on hover (and through a portal), so a static render
 * never shows it: the primitives are replaced by plain elements to see what Tip hands them. */
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children, dir, className }: { children: ReactNode; dir?: string; className?: string }) => <div data-content="" dir={dir} className={className}>{children}</div>,
}));
import { Tip } from "@/components/Tip";

describe("Tip — content direction", () => {
  it("is ltr by default, for codes, models and timestamps", () => {
    expect(renderToStaticMarkup(<Tip text="ENGINE_ERROR"><b>chip</b></Tip>)).toContain('<div data-content="" dir="ltr"');
  });
  it("takes the direction it is given, for prose that may be Hebrew", () => {
    expect(renderToStaticMarkup(<Tip text="מידע: רשם החברות" dir="auto"><b>chip</b></Tip>)).toContain('<div data-content="" dir="auto"');
  });
});
