"use client";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/Tip";
import { DocIcon } from "@/lib/doc-icons";
import { docFamily, familyChipClass } from "@/lib/doc-types";
import { cn } from "@/lib/utils";

/** The document (not the region) a row or result is about: icon + human label in the family's
 * colour. `label` overrides that label where the family name is not enough — the extract
 * page's own ledger, which shows a card and its sefach as two separate frames. */
export function DocTypeChip({ type, label, className }: { type: string | null | undefined; label?: string; className?: string }) {
  const t = useTranslations("labels.docTypes");
  const family = docFamily(type);
  if (!family) return <span className="text-muted-foreground">—</span>;
  return (
    <Tip text={type && type !== family ? type : null} mono>
      <Badge variant="outline" data-doc-family={family} className={cn("gap-1.5 rounded-sm font-sans", familyChipClass(family), className)}>
        <DocIcon type={family} className="size-3.5" />{label ?? t(family)}
      </Badge>
    </Tip>
  );
}
