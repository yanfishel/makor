import { describe, expect, it } from "vitest";
import { engineChoice, engineLabel, parseEngineModel, type EngineCatalogue } from "@/lib/engine-label";
import type { UserSettingsRow } from "@/lib/db/schema";

const settings = (over: Partial<UserSettingsRow> = {}): UserSettingsRow => ({
  userId: "u1", storeResults: false, anthropicKeyEnc: null, anthropicKeyLast4: null,
  model: null, backend: null, localModel: null, checkRegistries: false, updatedAt: "", ...over,
});
const catalogue: EngineCatalogue = {
  backend: "ollama", default_local: "qwen3-vl:8b-instruct", default_cloud: "claude-opus-5",
  models: [{ id: "qwen3-vl:8b-instruct", label: "Qwen3-VL 8B" }, { id: "qwen3-vl:30b-a3b-instruct", label: "Qwen3-VL 30B-A3B" }],
};

describe("engineChoice", () => {
  it("sends only the resolved backend's own model", () => {
    expect(engineChoice(settings({ backend: "ollama", localModel: "qwen3-vl:30b-a3b-instruct", model: "claude-opus-5" }), "none"))
      .toEqual({ backend: "ollama", model: "qwen3-vl:30b-a3b-instruct" });
    expect(engineChoice(settings({ backend: "anthropic", model: "claude-sonnet-5", localModel: "qwen3-vl:30b-a3b-instruct" }), "none"))
      .toEqual({ backend: "anthropic", model: "claude-sonnet-5" });
  });
  it("leaves the choice to the engine when none was made", () => {
    expect(engineChoice(settings(), "none")).toEqual({ backend: null, model: null });
  });
  it("is anthropic in clerk mode, and ignores a model outside the allow-list there", () => {
    expect(engineChoice(settings({ model: "claude-opus-5" }), "clerk")).toEqual({ backend: "anthropic", model: "claude-opus-5" });
    expect(engineChoice(settings({ model: "some-other-model" }), "clerk")).toEqual({ backend: "anthropic", model: null });
  });
});

describe("engineLabel", () => {
  it("prints a local model's name, not its tag", () => {
    expect(engineLabel({ backend: "ollama", model: "qwen3-vl:30b-a3b-instruct" }, catalogue))
      .toEqual({ backend: "ollama", model: "Qwen3-VL 30B-A3B" });
  });
  it("falls back to the raw tag while the catalogue is unknown", () => {
    expect(engineLabel({ backend: "ollama", model: "qwen3-vl:8b-instruct" }, null))
      .toEqual({ backend: "ollama", model: "qwen3-vl:8b-instruct" });
    expect(engineLabel({ backend: null, model: null }, null)).toEqual({ backend: null, model: null });
  });
  it("takes the engine's own defaults when nothing was chosen", () => {
    expect(engineLabel({ backend: null, model: null }, catalogue)).toEqual({ backend: "ollama", model: "Qwen3-VL 8B" });
  });
  it("names the tuned local default even when the engine itself defaults to anthropic", () => {
    const cloudFirst: EngineCatalogue = { ...catalogue, backend: "anthropic" };
    expect(engineLabel({ backend: "ollama", model: null }, cloudFirst)).toEqual({ backend: "ollama", model: "Qwen3-VL 8B" });
    expect(engineLabel({ backend: null, model: null }, cloudFirst)).toEqual({ backend: "anthropic", model: "Claude Opus 5" });
  });
  it("names the cloud default without asking the engine — the app ships that default itself", () => {
    // A cloud run with nothing chosen was written as "Anthropic" alone until GET /models came
    // back, and the model arrived a beat later under the heading.
    expect(engineLabel({ backend: "anthropic", model: null }, null)).toEqual({ backend: "anthropic", model: "Claude Opus 5" });
  });
  it("lets the engine's own cloud default win over the shipped one", () => {
    const pinned: EngineCatalogue = { ...catalogue, backend: "anthropic", default_cloud: "claude-sonnet-5" };
    expect(engineLabel({ backend: "anthropic", model: null }, pinned)).toEqual({ backend: "anthropic", model: "Claude Sonnet 5" });
  });
  it("reads the engine's own answer back", () => {
    expect(parseEngineModel("ollama/qwen3-vl:8b-instruct")).toEqual({ backend: "ollama", model: "qwen3-vl:8b-instruct" });
    expect(parseEngineModel("anthropic/claude-opus-5")).toEqual({ backend: "anthropic", model: "claude-opus-5" });
    expect(parseEngineModel(null)).toEqual({ backend: null, model: null });
  });
});
