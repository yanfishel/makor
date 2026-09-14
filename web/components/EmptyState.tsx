import type { ReactNode } from "react";
import { DocSilhouette, type SilhouetteType } from "@/components/DocSilhouette";

export function EmptyState({ title, text, action, silhouette = "teudat_zehut" }: { title: string; text?: string; action?: ReactNode; silhouette?: SilhouetteType }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-foreground/25 px-6 py-12 text-center">
      <DocSilhouette type={silhouette} className="h-12 text-foreground/40" />
      <p className="font-medium">{title}</p>
      {text && <p className="max-w-sm text-[13px] text-muted-foreground">{text}</p>}
      {action}
    </div>
  );
}
