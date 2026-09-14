import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** The page column: every public section, the header's nav and the footer sit on it, so a
 * section that wants a full-width background just puts its content in one of these. */
export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)} {...props} />;
}
