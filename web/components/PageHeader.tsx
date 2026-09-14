import type { ReactNode } from "react";

/** The description slot takes any node — a string, a line with a link in it, a skeleton while
 * something is still being fetched — so it is wrapped in a div rather than a paragraph: a
 * block element inside a <p> is invalid HTML, and the browser closing the paragraph early is
 * a hydration mismatch. The typography is the same either way. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
