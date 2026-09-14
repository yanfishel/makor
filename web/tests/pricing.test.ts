import { describe, expect, it } from "vitest";
import { costUsd } from "@/lib/pricing";
import type { EngineUsage } from "@/lib/engine";

const call = (over: Partial<EngineUsage>): EngineUsage => ({
  backend: "anthropic", model: "claude-opus-5", schema_name: "X",
  input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, ...over,
});

describe("costUsd", () => {
  it("prices one Opus 5 call: input $5, output $25 per million", () => {
    expect(costUsd([call({ input_tokens: 1_000_000, output_tokens: 100_000 })])).toBeCloseTo(5 + 2.5, 9);
  });
  it("prices cache reads at a tenth and cache writes at five quarters of the input rate", () => {
    expect(costUsd([call({ cache_read_tokens: 1_000_000 })])).toBeCloseTo(0.5, 9);
    expect(costUsd([call({ cache_write_tokens: 1_000_000 })])).toBeCloseTo(6.25, 9);
  });
  it("sums calls per entry, so a document with two models is priced per model", () => {
    const usage = [call({ model: "claude-opus-5", input_tokens: 1_000_000 }), call({ model: "claude-haiku-4-5", input_tokens: 1_000_000 })];
    expect(costUsd(usage)).toBeCloseTo(5 + 1, 9);
  });
  it("is null for an ollama call, an unknown model, and an empty usage list", () => {
    expect(costUsd([call({ backend: "ollama", model: "qwen3-vl:8b-instruct", input_tokens: 1000 })])).toBeNull();
    expect(costUsd([call({ input_tokens: 1000 }), call({ model: "claude-9", input_tokens: 1000 })])).toBeNull();
    expect(costUsd([])).toBeNull();
  });
});
