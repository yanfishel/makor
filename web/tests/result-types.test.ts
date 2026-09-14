import { describe, expect, it } from "vitest";
import { fieldRows } from "@/lib/result-types";

describe("fieldRows", () => {
  it("keeps only filled {value, confidence} fields, in order", () => {
    const rows = fieldRows({
      first_name_he: { value: "ישראל", confidence: "high" },
      last_name_he: { value: null, confidence: "low" },
      id_number: { value: "123456782", confidence: "high" },
      not_a_field: "x",
    });
    expect(rows).toEqual([
      { name: "first_name_he", value: "ישראל", confidence: "high" },
      { name: "id_number", value: "123456782", confidence: "high" },
    ]);
  });
});
