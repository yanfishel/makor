import { cn } from "@/lib/utils";

export const SILHOUETTE_TYPES = ["teudat_zehut", "israeli_passport", "foreign_passport", "israeli_drivers_license", "cheque", "other"] as const;
export type SilhouetteType = (typeof SILHOUETTE_TYPES)[number];

const MAP: Record<string, SilhouetteType> = {
  teudat_zehut: "teudat_zehut", teudat_zehut_back: "teudat_zehut", teudat_zehut_sefach: "teudat_zehut",
  israeli_passport: "israeli_passport", foreign_passport: "foreign_passport",
  israeli_drivers_license: "israeli_drivers_license", disability_card: "israeli_drivers_license",  // a photo card: the same outline
  cheque: "cheque", cheque_back: "cheque",
};

export function silhouetteType(docType: string | null | undefined): SilhouetteType {
  return (docType && MAP[docType]) || "other";
}

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.2 } as const;

/** Simplified outlines in the 120×56 box: a card + sheet, a passport spread, a licence, a cheque, a plain page. */
export function DocSilhouette({ type, className }: { type: SilhouetteType; className?: string }) {
  const common = { viewBox: "0 0 120 56", className: cn("shrink-0", className), "aria-hidden": true as const, ...STROKE };
  switch (type) {
    case "teudat_zehut":
      return <svg {...common}><rect x="2" y="6" width="70" height="44" rx="4" /><rect x="8" y="14" width="16" height="20" /><path d="M30 18h30M30 26h24M30 34h30" /><rect x="78" y="2" width="40" height="52" /><path d="M84 10h28M84 18h28M84 26h20M84 34h28M84 42h20" strokeOpacity=".5" /></svg>;
    case "israeli_passport":
    case "foreign_passport":
      return <svg {...common}><rect x="8" y="2" width="104" height="52" rx="3" /><path d="M60 2v52" strokeOpacity=".5" /><rect x="14" y="10" width="16" height="20" /><path d="M66 12h36M66 20h28M66 28h36" /><path d="M66 44h40" strokeDasharray="2 2" /></svg>;
    case "israeli_drivers_license":
      return <svg {...common}><rect x="20" y="8" width="80" height="40" rx="4" /><rect x="26" y="16" width="14" height="18" /><path d="M46 18h40M46 26h30M46 34h40" /></svg>;
    case "cheque":
      return <svg {...common}><rect x="2" y="10" width="116" height="38" /><path d="M10 26h80M10 34h50" /><path d="M10 42h60" strokeDasharray="3 2" /><rect x="94" y="16" width="18" height="8" /></svg>;
    default:
      return <svg {...common}><rect x="30" y="2" width="60" height="52" /><path d="M38 12h44M38 20h34M38 28h44M38 36h30" strokeOpacity=".6" /></svg>;
  }
}
