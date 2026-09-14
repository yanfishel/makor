import { describe, expect, it } from "vitest";
import { DOC_FAMILIES, docFamily, familyBarClass, familyChipClass, familyTypes } from "@/lib/doc-types";

describe("docFamily", () => {
  it("folds the engine's region types into the documents a user recognises", () => {
    expect(docFamily("teudat_zehut")).toBe("teudat_zehut");
    expect(docFamily("teudat_zehut_back")).toBe("teudat_zehut");
    expect(docFamily("teudat_zehut_sefach")).toBe("teudat_zehut");
    expect(docFamily("cheque")).toBe("cheque");
    expect(docFamily("cheque_back")).toBe("cheque");
    expect(docFamily("israeli_passport")).toBe("israeli_passport");
    expect(docFamily("foreign_passport")).toBe("foreign_passport");
    expect(docFamily("israeli_drivers_license")).toBe("israeli_drivers_license");
    expect(docFamily("disability_card")).toBe("disability_card");
  });
  it("puts not_a_document, other and unreadable in one bucket and answers null for nothing", () => {
    for (const t of ["not_a_document", "other", "unreadable", "something_new"]) expect(docFamily(t)).toBe("not_a_document");
    expect(docFamily(null)).toBeNull();
    expect(docFamily(undefined)).toBeNull();
  });
  it("familyTypes is the inverse: every raw type of a family, and every family is listed once", () => {
    expect(familyTypes("cheque")).toEqual(["cheque", "cheque_back"]);
    expect(familyTypes("teudat_zehut")).toEqual(["teudat_zehut", "teudat_zehut_back", "teudat_zehut_sefach"]);
    expect(new Set(DOC_FAMILIES).size).toBe(DOC_FAMILIES.length);
    for (const f of DOC_FAMILIES) for (const raw of familyTypes(f)) expect(docFamily(raw)).toBe(f);
  });
  it("folds every positive classifier kind (FrameClass in engine/app/schemas.py) onto a real family, never junk", () => {
    // Mirrors the engine's Literal, minus "none" (that one IS junk, correctly).
    const CLASSIFIER_KINDS = [
      "teudat_zehut", "teudat_zehut_back", "sefach", "israeli_passport", "foreign_passport",
      "drivers_license", "senior_citizen_card", "disability_card", "weapon_license",
      "cheque_front", "cheque_back",
    ];
    for (const kind of CLASSIFIER_KINDS) expect(docFamily(kind)).not.toBe("not_a_document");
    expect(docFamily("none")).toBe("not_a_document");
  });
  it("colours come from doc-* tokens only, the junk bucket from the muted ones", () => {
    for (const f of DOC_FAMILIES) {
      const chip = familyChipClass(f);
      expect(chip).not.toMatch(/emerald|amber|red-|zinc|blue-|violet-/);
      expect(chip).toMatch(f === "not_a_document" ? /muted/ : /text-doc-/);
      expect(familyBarClass(f)).toMatch(f === "not_a_document" ? /bg-muted-foreground/ : /bg-doc-/);
    }
  });
});
