import { describe, expect, it } from "vitest";
import { barWidths } from "@/components/BarList";

describe("barWidths", () => {
  it("scales to the largest row and never divides by zero", () => {
    expect(barWidths([{ key: "a", n: 4 }, { key: "b", n: 1 }])).toEqual([100, 25]);
    expect(barWidths([])).toEqual([]);
    expect(barWidths([{ key: "a", n: 0 }])).toEqual([0]);
  });
});
