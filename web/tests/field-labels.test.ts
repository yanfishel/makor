import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import he from "@/messages/he.json";
import { fieldLabel, type LabelTranslator } from "@/lib/field-labels";

/** next-intl's translator, reduced to what fieldLabel asks of it: a lookup under `labels`
 *  and the `{n}` substitution of the child group. */
const translator = (messages: Record<string, unknown>): LabelTranslator => {
  const at = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
  const t = (key: string, values: Record<string, string | number> = {}) =>
    String(at(key)).replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
  return Object.assign(t, { has: (key: string) => typeof at(key) === "string" });
};
const t = translator(en.labels);

describe("fieldLabel", () => {
  it("prints a known name and keeps the raw one beside it", () => {
    expect(fieldLabel("first_name_he", t)).toEqual({ text: "First name", raw: "first_name_he", translated: true });
    expect(fieldLabel("amount_in_words", t)).toEqual({ text: "Amount in words", raw: "amount_in_words", translated: true });
  });
  it("keeps an unknown name as it is, and says so", () => {
    expect(fieldLabel("brand_new_field", t)).toEqual({ text: "brand_new_field", raw: "brand_new_field", translated: false });
  });
  it("names the person a nested row belongs to, and lets an address row stand alone", () => {
    expect(fieldLabel("children[0].id_number", t).text).toBe("Child 1 · ID number");
    expect(fieldLabel("children[11].date_of_birth", t).text).toBe("Child 12 · Date of birth");
    expect(fieldLabel("spouse.last_name_he", t).text).toBe("Spouse · Family name");
    expect(fieldLabel("address.city", t).text).toBe("City");
    expect(fieldLabel("address.city", t).raw).toBe("address.city");
  });
  it("translates in Hebrew too, with the same vocabulary", () => {
    expect(Object.keys(he.labels.fields)).toEqual(Object.keys(en.labels.fields));
    expect(fieldLabel("id_number", translator(he.labels)).text).toBe("מספר זהות");
    expect(fieldLabel("children[0].id_number", translator(he.labels)).text).toBe("ילד/ה 1 · מספר זהות");
  });
});
