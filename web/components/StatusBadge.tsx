import { Badge } from "@/components/ui/badge";
import { statusTone, toneClass, type Tone } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

/** `tone` is a Tone, or a raw verdict/status word whose tone `statusTone` knows (so a translated label keeps its colour). */
export function StatusBadge({ value, tone, className }: { value: string; tone?: Tone | string; className?: string }) {
  const resolved: Tone = tone === "success" || tone === "warning" || tone === "destructive" || tone === "neutral" ? tone : statusTone(tone ?? value);
  return <Badge variant="outline" className={cn("rounded-sm font-mono", toneClass(resolved), className)}>{value}</Badge>;
}
