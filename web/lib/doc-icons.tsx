import { Banknote, BookUser, Car, FileQuestion, FileX, IdCard, ShieldCheck, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  teudat_zehut: IdCard, teudat_zehut_back: IdCard, teudat_zehut_sefach: IdCard,
  israeli_passport: BookUser, foreign_passport: BookUser,
  israeli_drivers_license: Car,
  senior_citizen_card: IdCard, disability_card: IdCard, weapon_license: ShieldCheck,
  cheque: Banknote, cheque_back: Banknote,
  not_a_document: FileX,
};

export function docIcon(type: string | null | undefined): LucideIcon {
  return (type && ICONS[type]) || FileQuestion;
}

export function DocIcon({ type, className }: { type: string | null | undefined; className?: string }) {
  const Icon = docIcon(type);
  return <Icon className={className} aria-hidden />;
}
