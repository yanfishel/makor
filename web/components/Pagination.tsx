import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { pageCount } from "@/lib/paging";

export interface PaginationLabels { prev: string; next: string; pageOf: string }

/**
 * Prev / "page X of N" / next; renders nothing for a single page. Give `hrefFor` for URL-driven
 * paging (links — server and client components alike) or `onPage` for in-place paging (buttons,
 * e.g. inside a modal, where a navigation would close it).
 */
export function Pagination({ page, total, pageSize, hrefFor, onPage, labels }: {
  page: number; total: number; pageSize: number; labels: PaginationLabels;
  hrefFor?: (page: number) => string; onPage?: (page: number) => void;
}) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;
  const btn = (target: number, label: string, enabled: boolean, Icon: typeof ChevronLeft) => {
    const icon = <Icon className="rtl:rotate-180" />;
    const inner = Icon === ChevronLeft ? <>{icon}{label}</> : <>{label}{icon}</>;
    if (!enabled) return <Button variant="outline" size="sm" disabled>{inner}</Button>;
    if (hrefFor) return <Button asChild variant="outline" size="sm"><Link href={hrefFor(target)}>{inner}</Link></Button>;
    return <Button type="button" variant="outline" size="sm" onClick={() => onPage?.(target)}>{inner}</Button>;
  };
  return (
    <nav aria-label="pagination" className="flex items-center justify-end gap-3 text-sm">
      {btn(page - 1, labels.prev, page > 1, ChevronLeft)}
      <span className="text-muted-foreground">{labels.pageOf}</span>
      {btn(page + 1, labels.next, page < pages, ChevronRight)}
    </nav>
  );
}
