import type { Sefach } from "@/lib/result-types";

/** The sheet as rows of the Fields table: the same name / value / confidence shape, in two
 * sections. Names keep the API's own spelling so a row can be found in the JSON tab; a block
 * (address, a person) carries one confidence, so every row of it shows that one. */
export interface SefachSection { title: "sefach" | "children"; rows: { name: string; value: string; confidence: string }[] }

export function sefachSections(sefach: Sefach): SefachSection[] {
  const rows: SefachSection["rows"] = [];
  const put = (name: string, value: string | null | undefined, confidence: string) => {
    if (value) rows.push({ name, value, confidence });
  };
  for (const name of ["id_number", "last_name_he", "first_name_he", "previous_last_name_he",
                      "previous_first_name_he", "maiden_name_he", "marital_status", "nationality",
                      "date_of_birth", "place_of_birth", "father_name_he", "mother_name_he",
                      "date_of_issue"] as const) {
    put(name, sefach[name].value, sefach[name].confidence);
  }
  if (sefach.address) {
    for (const name of ["street", "house_number", "entrance", "apartment", "city", "postal_code"] as const) {
      put(`address.${name}`, sefach.address[name], sefach.address.confidence);
    }
  }
  if (sefach.spouse) {
    for (const name of ["last_name_he", "first_name_he", "id_number", "date_of_birth", "sex"] as const) {
      put(`spouse.${name}`, sefach.spouse[name], sefach.spouse.confidence);
    }
  }
  const children: SefachSection["rows"] = [];
  sefach.children.forEach((child, i) => {
    for (const name of ["last_name_he", "first_name_he", "id_number", "date_of_birth", "sex"] as const) {
      if (child[name]) children.push({ name: `children[${i}].${name}`, value: child[name] as string, confidence: child.confidence });
    }
  });
  return [
    ...(rows.length ? [{ title: "sefach" as const, rows }] : []),
    ...(children.length ? [{ title: "children" as const, rows: children }] : []),
  ];
}

/** The same rows, flat, for the live ledger: while a page is being read the sheet's own
 * readings are what the sefach frame has to show — its derived `fields` are the card-shaped
 * subset (ID and names) and say nothing about the address or the children. */
export function sefachRows(sefach: Sefach): { name: string; value: string; confidence: string }[] {
  return sefachSections(sefach).flatMap((section) => section.rows);
}
