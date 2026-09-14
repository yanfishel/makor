import { describe, expect, it } from "vitest";
import { statusTone, toneClass } from "@/lib/status-tone";
import { regionFrameClass, regionMaskClass, regionTagClass } from "@/lib/status-tone";
import { invitationTone, sourceStateTone } from "@/lib/status-tone";

describe("statusTone", () => {
  it("maps verdicts, statuses and confidences onto the three status tokens", () => {
    expect(statusTone("verified")).toBe("success");
    expect(statusTone("ok")).toBe("success");
    expect(statusTone("high")).toBe("success");
    expect(statusTone("partial")).toBe("warning");
    expect(statusTone("pending")).toBe("warning");
    expect(statusTone("medium")).toBe("warning");
    expect(statusTone("mismatch")).toBe("destructive");
    expect(statusTone("failed")).toBe("destructive");
    expect(statusTone("low")).toBe("destructive");
    expect(statusTone("unverified")).toBe("neutral");
    expect(statusTone(null)).toBe("neutral");
  });
  it("only ever emits token classes", () => {
    for (const t of ["success", "warning", "destructive", "neutral"] as const) expect(toneClass(t)).not.toMatch(/emerald|amber|red-|zinc/);
  });
});

describe("region classes", () => {
  it("use the highlight token while live, success when read, destructive when failed, muted when skipped", () => {
    expect(regionFrameClass("found")).toContain("border-highlight");
    expect(regionFrameClass("found")).toContain("border-dashed");
    expect(regionMaskClass("reading")).toContain("shadow-[0_0_0_9999px");
    expect(regionMaskClass("read")).toBe("");
    expect(regionFrameClass("reading")).toContain("border-highlight");
    expect(regionFrameClass("read")).toContain("border-success");
    expect(regionFrameClass("failed")).toContain("border-destructive");
    expect(regionFrameClass("skipped")).toContain("border-muted-foreground");
    expect(regionTagClass("read")).toContain("bg-success");
  });
});

describe("sourceStateTone", () => {
  it("colours a registry source's state", () => {
    expect(["ok", "running", "interrupted", "error", "never"].map((s) => sourceStateTone(s as Parameters<typeof sourceStateTone>[0])))
      .toEqual(["success", "warning", "warning", "destructive", "neutral"]);
  });
});

describe("invitationTone", () => {
  it("colours an invitation's status", () => {
    expect(["pending", "accepted", "revoked", "expired"].map((s) => invitationTone(s as Parameters<typeof invitationTone>[0])))
      .toEqual(["warning", "success", "neutral", "destructive"]);
  });
});
