import { describe, expect, it } from "vitest";
import { digitsValue, isoFromCell, isoFromDmy, isoFromExcelSerial, isoFromYymmdd, isoFromYyyymmdd, normalizeName } from "@/lib/registries/normalize";

describe("digitsValue", () => {
  it("keeps digits only, so spaced and zero-padded forms compare equal", () => {
    expect(digitsValue("1 2345678 2")).toBe(123456782);
    expect(digitsValue("51-000000-3")).toBe(510000003);
    expect(digitsValue("000000123456")).toBe(123456);
    expect(digitsValue("0")).toBe(0);
  });
  it("is null when no digit is left or the number would not be exact", () => {
    expect(digitsValue("")).toBeNull();
    expect(digitsValue(null)).toBeNull();
    expect(digitsValue("abc")).toBeNull();
    expect(digitsValue("12345678901234567890")).toBeNull();
  });
});

describe("normalizeName", () => {
  it("drops niqqud, harakat, tatweel and every quote mark the sources use", () => {
    expect(normalizeName("שָׁלוֹם")).toBe("שלום");
    expect(normalizeName("مُحَمَّد")).toBe("محمد");
    expect(normalizeName("عـــلي")).toBe("علي");
    expect(normalizeName('בע"מ')).toBe("בעמ");
    expect(normalizeName("בע״מ")).toBe("בעמ");
    expect(normalizeName("בע~מ")).toBe("בעמ");
    expect(normalizeName("ג׳ורג'")).toBe("גורג");
  });
  it("turns maqaf and hyphens into spaces, lowercases, collapses whitespace", () => {
    expect(normalizeName("תל־אביב")).toBe("תל אביב");
    expect(normalizeName("  Al-Asima   NEWS ")).toBe("al asima news");
    expect(normalizeName(null)).toBe("");
  });
});

describe("dates", () => {
  it("reads the four forms the sources use", () => {
    expect(isoFromYyyymmdd("20260910")).toBe("2026-09-10");
    expect(isoFromYymmdd("260910")).toBe("2026-09-10");
    expect(isoFromDmy("01/05/2028")).toBe("2028-05-01");
    expect(isoFromExcelSerial(46275)).toBe("2026-09-10");
  });
  it("rejects impossible dates instead of rolling them over", () => {
    expect(isoFromYyyymmdd("20260231")).toBeNull();
    expect(isoFromDmy("31/02/2026")).toBeNull();
    expect(isoFromYyyymmdd("00000000")).toBeNull();
  });
  it("isoFromCell takes an Excel serial or DD/MM/YYYY text and nothing else", () => {
    expect(isoFromCell("46275")).toBe("2026-09-10");
    expect(isoFromCell("10/09/2026")).toBe("2026-09-10");
    expect(isoFromCell("--/--/----")).toBeNull();
    expect(isoFromCell("בוטל ביום 1.1.2020")).toBeNull();
  });
});
