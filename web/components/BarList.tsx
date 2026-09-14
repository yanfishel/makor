import type { LucideIcon } from "lucide-react";
import { statusTone, type Tone } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

export interface BarRow { key: string; n: number }

export function barWidths(rows: BarRow[]): number[] {
  const max = Math.max(0, ...rows.map((r) => r.n));
  return rows.map((r) => (max === 0 ? 0 : Math.round((r.n / max) * 100)));
}

const BAR: Record<Tone, string> = { success: "bg-success", warning: "bg-warning", destructive: "bg-destructive", neutral: "bg-foreground" };

/**
 * Horizontal bars, largest first. `byTone` colours by the key's status tone (verdict lists);
 * `barClass` names the bar colour per key (the document families); `label` names the row.
 */
export function BarList({ rows, byTone = false, icon: Icon, label, barClass }: {
  rows: BarRow[]; byTone?: boolean; icon?: (key: string) => LucideIcon; label?: (key: string) => string; barClass?: (key: string) => string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">—</p>;
  const widths = barWidths(rows);
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => { const RowIcon = Icon?.(r.key); return (
        <li key={r.key} className="space-y-1 text-sm">
          <div className="flex items-center gap-2"><span className={cn("flex items-center gap-1.5", label ? "text-sm" : "font-mono text-xs")}>{RowIcon && <RowIcon className="size-3.5 text-muted-foreground" />}{label ? label(r.key) : r.key}</span><span className="ms-auto tabular-nums">{r.n}</span></div>
          <div className="h-1 bg-muted"><div className={cn("h-full", barClass ? barClass(r.key) : BAR[byTone ? statusTone(r.key) : "neutral"])} style={{ width: `${widths[i]}%` }} /></div>
        </li>
      ); })}
    </ul>
  );
}
