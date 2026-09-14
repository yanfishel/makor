import type { RegistriesResult } from "@/lib/registries/check";

export interface ExtractedField { value: string | null; confidence: "high" | "medium" | "low" }
export interface RegionResult { label: string; bbox_2d: [number, number, number, number]; document_type: string | null; dpi?: number | null }

/* The appendix sheet (ספח), when the page carried one — the engine's SefachExtraction plus
 * the normalized marital-status code. Its address and person blocks are plain strings with
 * one confidence for the whole block, not per-field ExtractedFields. */
export interface SefachAddress {
  street: string | null; house_number: string | null; entrance: string | null;
  apartment: string | null; city: string | null; postal_code: string | null;
  confidence: ExtractedField["confidence"];
}
export interface SefachPerson {
  last_name_he: string | null; first_name_he: string | null; id_number: string | null;
  date_of_birth: string | null; sex: string | null; confidence: ExtractedField["confidence"];
}
export interface Sefach {
  id_number: ExtractedField;
  last_name_he: ExtractedField;
  first_name_he: ExtractedField;
  previous_last_name_he: ExtractedField;
  previous_first_name_he: ExtractedField;
  maiden_name_he: ExtractedField;
  father_name_he: ExtractedField;
  mother_name_he: ExtractedField;
  date_of_birth: ExtractedField;
  place_of_birth: ExtractedField;
  marital_status: ExtractedField;
  nationality: ExtractedField;
  date_of_issue: ExtractedField;
  address: SefachAddress | null;
  spouse: SefachPerson | null;
  children: SefachPerson[];
  notes: string | null;
  marital_status_code: string | null;
}

export interface ExtractResponse {
  document_type: string;
  fields: Record<string, ExtractedField | unknown>;
  validation: { overall: string; [k: string]: unknown };
  warnings: string[];
  regions: RegionResult[];
  sefach: Sefach | null;
  /** The owner's registries check: null when the option is off. */
  registries?: RegistriesResult | null;
  model: string;
  meta: { mode: string; trial_remaining: number | null; backend: string | null; model: string | null; document_id: string };
}

function isField(v: unknown): v is ExtractedField {
  return typeof v === "object" && v !== null && "value" in v && "confidence" in v;
}

export function fieldRows(fields: ExtractResponse["fields"]): { name: string; value: string; confidence: string }[] {
  return Object.entries(fields)
    .filter((e): e is [string, ExtractedField] => isField(e[1]) && e[1].value != null && e[1].value !== "")
    .map(([name, f]) => ({ name, value: String(f.value), confidence: f.confidence }));
}
