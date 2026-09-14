import type { AuthMode } from "@/lib/config";
import type { UserSettingsRow } from "@/lib/db/schema";
import { DEFAULT_CLOUD_MODEL, isAllowedCloudModel, MODEL_CHOICES } from "@/lib/settings";

/** What this user's next upload will ask the engine to run. `null` means "not chosen": the
 * engine's own default decides, and the web app cannot name it without asking (GET /models). */
export interface EngineChoice { backend: "ollama" | "anthropic" | null; model: string | null }

/** The precedence handleExtract sends to the engine, as a value the UI can print too — the
 * page under the heading and the request must never disagree about what is going to read
 * the document, so both take the answer from here.
 *
 * A model name is backend-specific, so only the resolved backend's own model travels: the
 * cloud model with anthropic (a clerk user's stored model outside the allow-list is ignored
 * in favour of the engine's default), the local model with ollama, none when no backend is
 * chosen. */
export function engineChoice(settings: UserSettingsRow, authMode: AuthMode): EngineChoice {
  const backend: EngineChoice["backend"] = authMode === "clerk" ? "anthropic"
    : settings.backend === "ollama" || settings.backend === "anthropic" ? settings.backend : null;
  if (backend === "anthropic" && settings.model && !(authMode === "clerk" && !isAllowedCloudModel(settings.model))) {
    return { backend, model: settings.model };
  }
  if (backend === "ollama" && settings.localModel) return { backend, model: settings.localModel };
  return { backend, model: null };
}

/** `"ollama/qwen3-vl:8b-instruct"` — the engine's own answer, which is what actually ran. */
export function parseEngineModel(value: string | null | undefined): EngineChoice {
  const [backend, ...rest] = String(value ?? "").split("/");
  const model = rest.join("/") || null;
  return { backend: backend === "ollama" || backend === "anthropic" ? backend : null, model };
}

/** What the engine offers, as the settings page reads it (GET /models through the web app).
 * `backend` is the engine's own default backend; `default_local` and `default_cloud` the model
 * each backend runs when a request names none. */
export interface EngineCatalogue { backend: string; default_local: string; default_cloud: string; models: { id: string; label: string }[] }

/** The choice as two printed parts: the backend's key (the caller translates it through
 * `labels.engines`) and the model's own name — "Qwen3-VL 8B", not "qwen3-vl:8b-instruct".
 *
 * Anything the catalogue has not answered for yet falls back to the raw tag rather than to
 * nothing: a model the engine knows and the web app does not is still a true answer.
 */
export function engineLabel(choice: EngineChoice, catalogue: EngineCatalogue | null): { backend: string | null; model: string | null } {
  const backend = choice.backend ?? (catalogue?.backend === "ollama" || catalogue?.backend === "anthropic" ? catalogue.backend : null);
  const model = choice.model ?? defaultModel(backend, catalogue);
  if (!model) return { backend, model: null };
  if (backend === "anthropic") return { backend, model: MODEL_CHOICES.find((m) => m.id === model)?.label ?? model };
  return { backend, model: catalogue?.models.find((m) => m.id === model)?.label ?? model };
}

/** The model a backend runs when nothing was chosen.
 *
 * The cloud one is known without asking: the app ships `DEFAULT_CLOUD_MODEL` and the settings
 * page already calls it the default, so the line can be written on the first paint instead of
 * waiting for GET /models to say the same thing. The engine may still pin another cloud model
 * (`MAKOR_MODEL` on an anthropic engine), and its answer corrects the line when it arrives.
 *
 * The local tag is the engine's to name — the allow-list and its order live in its config —
 * so until the catalogue answers there is nothing to print. */
function defaultModel(backend: string | null, catalogue: EngineCatalogue | null): string | null {
  if (backend === "anthropic") return catalogue?.default_cloud ?? DEFAULT_CLOUD_MODEL;
  if (backend === "ollama") return catalogue?.default_local ?? null;
  return null;
}
