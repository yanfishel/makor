import { describe, expect, it } from "vitest";
import { decideMode } from "@/lib/mode";

describe("decideMode", () => {
  it("none mode is always local, key or not", () => {
    expect(decideMode({ authMode: "none", hasByokKey: false, trialUsed: 99, trialDocs: 5 })).toBe("local");
    expect(decideMode({ authMode: "none", hasByokKey: true, trialUsed: 0, trialDocs: 5 })).toBe("local");
  });
  it("clerk mode with a key is byok regardless of trial", () => {
    expect(decideMode({ authMode: "clerk", hasByokKey: true, trialUsed: 5, trialDocs: 5 })).toBe("byok");
  });
  it("clerk mode without a key runs the trial until exhausted", () => {
    expect(decideMode({ authMode: "clerk", hasByokKey: false, trialUsed: 4, trialDocs: 5 })).toBe("trial");
    expect(decideMode({ authMode: "clerk", hasByokKey: false, trialUsed: 5, trialDocs: 5 })).toBe("exhausted");
    expect(decideMode({ authMode: "clerk", hasByokKey: false, trialUsed: 0, trialDocs: 0 })).toBe("exhausted");
  });
});

describe("decideMode — unlimited users", () => {
  it("an unlimited user without a key stays on trial past the cap", () => {
    expect(decideMode({ authMode: "clerk", hasByokKey: false, trialUsed: 99, trialDocs: 5, unlimited: true })).toBe("trial");
    expect(decideMode({ authMode: "clerk", hasByokKey: false, trialUsed: 0, trialDocs: 0, unlimited: true })).toBe("trial");
  });
  it("a key still wins over the exemption", () => {
    expect(decideMode({ authMode: "clerk", hasByokKey: true, trialUsed: 0, trialDocs: 5, unlimited: true })).toBe("byok");
  });
});
