/**
 * The engine answers with REGION types (a card front, its back, the sefach sheet, a cheque's
 * back...); the UI shows DOCUMENTS. This is the one place that folds the former into the
 * latter — labels come from the `labels.docTypes` messages, colours from the `--doc-*` tokens.
 */
export const DOC_FAMILIES = [
  "teudat_zehut", "israeli_passport", "foreign_passport", "israeli_drivers_license",
  "disability_card", "senior_citizen_card", "weapon_license", "cheque", "not_a_document",
] as const;
export type DocFamily = (typeof DOC_FAMILIES)[number];

const TYPES: Record<DocFamily, string[]> = {
  teudat_zehut: ["teudat_zehut", "teudat_zehut_back", "teudat_zehut_sefach"],
  israeli_passport: ["israeli_passport"],
  foreign_passport: ["foreign_passport"],
  israeli_drivers_license: ["israeli_drivers_license"],
  disability_card: ["disability_card"],
  senior_citizen_card: ["senior_citizen_card"],
  weapon_license: ["weapon_license"],
  cheque: ["cheque", "cheque_back"],
  not_a_document: ["not_a_document", "other", "unreadable"],
};
const FAMILY_OF = new Map<string, DocFamily>(DOC_FAMILIES.flatMap((f) => TYPES[f].map((t) => [t, f] as const)));

/** The live classifier (`FrameClass.kind` in `engine/app/schemas.py`) answers with its own
 * vocabulary, not the reader's `document_type` one `TYPES` above indexes — a region shows this
 * kind from `classified` until the `read` event replaces it with the reader's own type. Fold
 * the classifier kinds that don't already spell a reader type onto the same family so a region
 * being read never reads "Not a document" on screen while it is being read. Deliberately not
 * in `TYPES`/`familyTypes`: those feed the documents-list filter, which matches stored
 * `document_type` values, and a classifier kind never appears there. `"none"` stays unmapped —
 * it is correctly junk. */
const CLASSIFIER_ALIAS: Record<string, DocFamily> = {
  sefach: "teudat_zehut",
  drivers_license: "israeli_drivers_license",
  cheque_front: "cheque",
};

/** The appendix sheet, in either vocabulary (the reader's type, the classifier's kind). It is
 * a `teudat_zehut` like the card for every list, filter and chip in the app — but on the
 * extract page the card and its sheet are two boxes side by side, and calling both of them
 * "Teudat Zehut" says nothing about which is which. */
const SEFACH_TYPES = new Set(["teudat_zehut_sefach", "sefach"]);
export function isSefachRegion(type: string | null | undefined): boolean {
  return Boolean(type && SEFACH_TYPES.has(type));
}

/** The family of a region or classifier type; an unknown type is junk, nothing (a failed row)
 * is null. */
export function docFamily(type: string | null | undefined): DocFamily | null {
  if (!type) return null;
  return FAMILY_OF.get(type) ?? CLASSIFIER_ALIAS[type] ?? "not_a_document";
}

/** Every region type a family filter must match; an unknown family matches nothing. */
export function familyTypes(family: string): string[] {
  return TYPES[family as DocFamily] ?? [];
}

const TOKEN: Record<Exclude<DocFamily, "not_a_document">, string> = {
  teudat_zehut: "teudat-zehut", israeli_passport: "israeli-passport", foreign_passport: "foreign-passport",
  israeli_drivers_license: "israeli-drivers-license", disability_card: "disability-card",
  senior_citizen_card: "senior-citizen-card", weapon_license: "weapon-license", cheque: "cheque",
};
/* Tailwind needs the class names spelled out in full to emit them. */
const CHIP: Record<DocFamily, string> = {
  teudat_zehut: "border-doc-teudat-zehut/25 bg-doc-teudat-zehut/10 text-doc-teudat-zehut",
  israeli_passport: "border-doc-israeli-passport/25 bg-doc-israeli-passport/10 text-doc-israeli-passport",
  foreign_passport: "border-doc-foreign-passport/25 bg-doc-foreign-passport/10 text-doc-foreign-passport",
  israeli_drivers_license: "border-doc-israeli-drivers-license/25 bg-doc-israeli-drivers-license/10 text-doc-israeli-drivers-license",
  disability_card: "border-doc-disability-card/25 bg-doc-disability-card/10 text-doc-disability-card",
  senior_citizen_card: "border-doc-senior-citizen-card/25 bg-doc-senior-citizen-card/10 text-doc-senior-citizen-card",
  weapon_license: "border-doc-weapon-license/25 bg-doc-weapon-license/10 text-doc-weapon-license",
  cheque: "border-doc-cheque/25 bg-doc-cheque/10 text-doc-cheque",
  not_a_document: "border-border bg-muted text-muted-foreground",
};
const BAR: Record<DocFamily, string> = {
  teudat_zehut: "bg-doc-teudat-zehut", israeli_passport: "bg-doc-israeli-passport", foreign_passport: "bg-doc-foreign-passport",
  israeli_drivers_license: "bg-doc-israeli-drivers-license", disability_card: "bg-doc-disability-card",
  senior_citizen_card: "bg-doc-senior-citizen-card", weapon_license: "bg-doc-weapon-license", cheque: "bg-doc-cheque",
  not_a_document: "bg-muted-foreground",
};

/** Chip classes (border / tint / text) of a family; the junk bucket is muted. */
export function familyChipClass(family: DocFamily | null): string {
  return CHIP[family ?? "not_a_document"];
}
/** The bar colour of a family in the "by type" lists. */
export function familyBarClass(family: DocFamily | null): string {
  return BAR[family ?? "not_a_document"];
}
export const DOC_TOKENS = TOKEN;
