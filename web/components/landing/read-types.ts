import type { SilhouetteType } from "@/components/DocSilhouette";

/** Field identifiers per document type (index-aligned with `landing.reads.types`); `key` = cross-checked by validation. */
export const READ_TYPES: { type: SilhouetteType; fields: string[]; key: string[] }[] = [
  { type: "teudat_zehut", fields: ["id_number", "first_name_he", "last_name_he", "date_of_birth", "date_of_issue", "date_of_expiry", "address", "marital_status", "spouse", "children[]"], key: ["id_number"] },
  { type: "israeli_passport", fields: ["passport_number", "mrz_lines", "last_name_en", "first_name_en", "last_name_he", "first_name_he", "nationality", "sex", "dates"], key: ["passport_number", "mrz_lines"] },
  { type: "foreign_passport", fields: ["passport_number", "mrz_lines", "last_name_en", "first_name_en", "nationality", "sex", "dates"], key: ["passport_number", "mrz_lines"] },
  { type: "israeli_drivers_license", fields: ["license_number", "id_number", "names", "dates", "address", "categories"], key: ["license_number", "id_number"] },
  { type: "israeli_drivers_license", fields: ["id_number", "file_number", "names", "date_of_expiry"], key: ["id_number"] },
  { type: "cheque", fields: ["micr_line", "bank", "branch", "account", "cheque_number", "drawer", "payee", "amount", "amount_words", "date", "guarantor"], key: ["micr_line"] },
];
