import { describe, expect, it } from "vitest";
import { modeSummary } from "@/lib/mode-summary";

const base = { authMode: "clerk" as const, hasKey: false, unlimited: false, trialDocs: 5, trialUsed: 2 };

describe("modeSummary", () => {
  it("local mode wins over everything", () => {
    expect(modeSummary({ ...base, authMode: "none", hasKey: true })).toEqual({ kind: "local" });
  });
  it("a saved key beats unlimited", () => {
    expect(modeSummary({ ...base, hasKey: true, unlimited: true })).toEqual({ kind: "byok" });
  });
  it("unlimited beats the trial counter", () => {
    expect(modeSummary({ ...base, unlimited: true })).toEqual({ kind: "unlimited" });
  });
  it("trial reports what is left, never below zero", () => {
    expect(modeSummary(base)).toEqual({ kind: "trial", left: 3, total: 5 });
    expect(modeSummary({ ...base, trialUsed: 9 })).toEqual({ kind: "trial", left: 0, total: 5 });
  });
});
