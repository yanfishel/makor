import { describe, expect, it } from "vitest";
import { engineLabel, formatFieldDate, formatMs, statusLabel, formatCost, formatTokens } from "@/lib/format";

describe("format", () => {
  it("formatFieldDate rewrites a date and nothing else", () => {
    expect(formatFieldDate("2023-02-19")).toBe("19.02.2023");
    expect(formatFieldDate("2014-03")).toBe("03.2014");        // the disability card's month-precision expiry
    expect(formatFieldDate("123456782")).toBeNull();
    expect(formatFieldDate("2023-13-19")).toBeNull();
    expect(formatFieldDate("P<ISR<<<<<")).toBeNull();
    expect(formatFieldDate("רחוב יונתן 31")).toBeNull();
  });
  it("formatMs", () => {
    expect(formatMs(850)).toBe("850ms");
    expect(formatMs(1234)).toBe("1.2s");
    expect(formatMs(null)).toBe("—");
  });
  it("statusLabel", () => {
    expect(statusLabel({ status: 200, errorCode: null })).toBe("ok");
    expect(statusLabel({ status: 102, errorCode: null })).toBe("pending");
    expect(statusLabel({ status: 502, errorCode: "ENGINE_ERROR" })).toBe("failed");
  });
});

describe("engineLabel", () => {
  it("names the backend that ran the document, whatever the billing mode", () => {
    expect(engineLabel("anthropic")).toBe("anthropic");
    expect(engineLabel("ollama")).toBe("ollama");
    expect(engineLabel(null)).toBe("—");
  });
});

describe("formatCost", () => {
  it("shows dollars to the tenth of a cent, a dash for an unpriced document, a floor for a tiny bill", () => {
    expect(formatCost(0.0452)).toBe("$0.045");
    expect(formatCost(1.5)).toBe("$1.500");
    expect(formatCost(0.0002)).toBe("<$0.001");
    expect(formatCost(0)).toBe("$0.000");
    expect(formatCost(null)).toBe("—");
  });
});

describe("formatTokens", () => {
  it("prints input / output with locale grouping", () => {
    expect(formatTokens(12345, 678, "en")).toBe("12,345 / 678");
    expect(formatTokens(0, 0, "en")).toBe("0 / 0");
  });
});

describe("formatCost with two decimals (dashboard totals)", () => {
  it("rounds to cents and floors a tiny total", () => {
    expect(formatCost(0.1234, 2)).toBe("$0.12");
    expect(formatCost(0.004, 2)).toBe("<$0.01");
    expect(formatCost(null, 2)).toBe("—");
  });
});

import { formatFileSize } from "@/lib/format";

describe("formatFileSize", () => {
  it("counts whole kilobytes below a megabyte and one decimal above", () => {
    expect(formatFileSize(40 * 1024)).toBe("40 KB");
    expect(formatFileSize(1_500_000)).toBe("1.4 MB");
    expect(formatFileSize(30 * 1024 * 1024)).toBe("30.0 MB");
  });
  it("never rounds a tiny file down to nothing", () => {
    expect(formatFileSize(200)).toBe("1 KB");
  });
});
