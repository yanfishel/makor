import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, zipSync } from "fflate";
import { readFirstSheet, unzipFirst } from "@/lib/registries/xlsx";
import { buildXlsx } from "./registries-fixtures";

describe("readFirstSheet", () => {
  it("reads inline strings, numbers and empty cells by column", () => {
    expect(readFirstSheet(buildXlsx([["a", null, 3], [], ["x & y"]]))).toEqual([["a", "", "3"], [], ["x & y"]]);
  });
  it("reads shared strings and decodes entities", () => {
    expect(readFirstSheet(buildXlsx([["שם", "Name"], ["דוגמה <x>", 46275]], { shared: true }))).toEqual([["שם", "Name"], ["דוגמה <x>", "46275"]]);
  });
  it("places a cell by its reference and joins rich-text runs", () => {
    const xml = '<worksheet><sheetData><row r="3"><c r="C3" t="inlineStr"><is><r><t>ab</t></r><r><t xml:space="preserve">cd</t></r></is></c></row></sheetData></worksheet>';
    expect(readFirstSheet(zipSync({ "xl/worksheets/sheet1.xml": strToU8(xml) }))).toEqual([[], [], ["", "", "abcd"]]);
  });
  it("throws on an archive with no worksheet", () => {
    expect(() => readFirstSheet(zipSync({ "a.txt": strToU8("x") }))).toThrow(/no worksheet/);
  });
});

describe("unzipFirst", () => {
  it("returns the one file of an archive", () => {
    const { name, data } = unzipFirst(zipSync({ "F.TXT": strToU8("hello") }));
    expect(name).toBe("F.TXT");
    expect(strFromU8(data)).toBe("hello");
  });
});
