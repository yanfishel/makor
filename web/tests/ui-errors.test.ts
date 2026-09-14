import { describe, expect, it } from "vitest";
import { errorMessageKey, settingsErrorKey } from "@/lib/ui-errors";
describe("errorMessageKey", () => {
  it("maps known codes and falls back", () => {
    expect(errorMessageKey("TRIAL_EXHAUSTED")).toBe("errors.TRIAL_EXHAUSTED");
    expect(errorMessageKey("ANTHROPIC_UNREACHABLE")).toBe("errors.ANTHROPIC_UNREACHABLE");
    expect(errorMessageKey("WHATEVER")).toBe("errors.generic");
    expect(errorMessageKey(undefined)).toBe("errors.generic");
  });
});

describe("settingsErrorKey", () => {
  it("keeps only the codes the settings namespace defines", () => {
    expect(settingsErrorKey("ANTHROPIC_KEY_INVALID")).toBe("errors.ANTHROPIC_KEY_INVALID");
    expect(settingsErrorKey("UNAUTHENTICATED")).toBe("errors.UNAUTHENTICATED");
    expect(settingsErrorKey("TOKEN_INVALID")).toBe("errors.generic");
    expect(settingsErrorKey("SESSION_REQUIRED")).toBe("errors.generic");
    expect(settingsErrorKey(undefined)).toBe("errors.generic");
  });
});
