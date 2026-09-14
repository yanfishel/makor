import { describe, expect, it } from "vitest";
import { engineChipClass, sourceChipClass } from "@/lib/chip-tone";

describe("engine and source chips", () => {
  it("give ollama and anthropic, web and api their own token colours, unknown values the neutral ones", () => {
    expect(engineChipClass("ollama")).toContain("text-engine-ollama");
    expect(engineChipClass("anthropic")).toContain("text-engine-anthropic");
    expect(engineChipClass("ollama")).not.toBe(engineChipClass("anthropic"));
    expect(sourceChipClass("ui")).toContain("text-source-ui");
    expect(sourceChipClass("api")).toContain("text-source-api");
    for (const c of [engineChipClass("other"), sourceChipClass("cli")]) expect(c).toContain("text-muted-foreground");
    for (const c of [engineChipClass("ollama"), sourceChipClass("api")]) expect(c).not.toMatch(/emerald|amber|red-|zinc|blue-|violet-/);
  });
});
