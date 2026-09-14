import { describe, expect, it } from "vitest";
import { Banknote, BookUser, Car, FileQuestion, FileX, IdCard, ShieldCheck } from "lucide-react";
import { docIcon } from "@/lib/doc-icons";

describe("docIcon", () => {
  it("gives every document_type an icon", () => {
    expect(docIcon("teudat_zehut")).toBe(IdCard);
    expect(docIcon("teudat_zehut_back")).toBe(IdCard);
    expect(docIcon("teudat_zehut_sefach")).toBe(IdCard);
    expect(docIcon("israeli_passport")).toBe(BookUser);
    expect(docIcon("foreign_passport")).toBe(BookUser);
    expect(docIcon("israeli_drivers_license")).toBe(Car);
    expect(docIcon("cheque")).toBe(Banknote);
    expect(docIcon("cheque_back")).toBe(Banknote);
    expect(docIcon("other")).toBe(FileQuestion);
    expect(docIcon(null)).toBe(FileQuestion);
    expect(docIcon("senior_citizen_card")).toBe(IdCard);
    expect(docIcon("disability_card")).toBe(IdCard);
    expect(docIcon("weapon_license")).toBe(ShieldCheck);
    expect(docIcon("not_a_document")).toBe(FileX);
  });
});
