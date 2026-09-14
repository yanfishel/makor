import { getConfig } from "@/lib/config";

export interface EngineOverrides { backend?: "ollama" | "anthropic"; model?: string; anthropicKey?: string }
export interface EngineUsage {
  backend: string; model: string; schema_name: string;
  input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EngineResult { status: number; body: any; retryAfter: string | null }
export class EngineUnavailable extends Error {}
export class EngineTimeout extends Error {}

/** GET /models on the engine: the local allow-list with what Ollama has pulled. */
export interface EngineModels {
  backend: string; default_local: string; default_cloud: string; ollama_reachable: boolean;
  models: { id: string; label: string; note: string; installed: boolean }[];
}

/** Proxy one upload to the engine. The user's Anthropic key travels only on this hop. */
export async function extractWithEngine(
  file: Blob, filename: string, overrides: EngineOverrides,
  deps: { engineUrl?: string; engineSecret?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EngineResult> {
  const needsCfg = deps.engineUrl === undefined || deps.engineSecret === undefined || deps.timeoutMs === undefined;
  const cfg = needsCfg ? getConfig() : null;
  const engineUrl = deps.engineUrl ?? cfg!.engineUrl;
  const engineSecret = deps.engineSecret ?? cfg!.engineSecret;
  const timeoutMs = deps.timeoutMs ?? cfg!.engineTimeoutMs;
  const doFetch = deps.fetchImpl ?? fetch;

  const form = new FormData();
  form.append("file", file, filename);
  const headers: Record<string, string> = {};
  if (engineSecret) headers["X-Engine-Secret"] = engineSecret;
  if (overrides.backend) headers["X-Backend"] = overrides.backend;
  if (overrides.model) headers["X-Model"] = overrides.model;
  if (overrides.anthropicKey) headers["X-Anthropic-Key"] = overrides.anthropicKey;

  let response: Response;
  try {
    response = await doFetch(`${engineUrl}/extract`, { method: "POST", body: form, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new EngineTimeout(`engine did not respond within ${timeoutMs}ms`);
    throw new EngineUnavailable(`engine unreachable: ${(err as Error).name}`);
  }
  const text = await response.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { detail: text };
  }
  return { status: response.status, body, retryAfter: response.headers.get("retry-after") };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EngineStreamResult { status: number; stream: ReadableStream<Uint8Array> | null; body: any; retryAfter: string | null }

/** The NDJSON form of the engine's /extract: the same request plus `Accept`. `timeoutMs`
 * bounds the wait for the HEADERS only — the body's pace is the reader's business
 * (readNdjson's idleMs) — so the controller is never aborted once the stream is open. */
export async function extractStreamWithEngine(
  file: Blob, filename: string, overrides: EngineOverrides,
  deps: { engineUrl?: string; engineSecret?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EngineStreamResult> {
  const needsCfg = deps.engineUrl === undefined || deps.engineSecret === undefined || deps.timeoutMs === undefined;
  const cfg = needsCfg ? getConfig() : null;
  const engineUrl = deps.engineUrl ?? cfg!.engineUrl;
  const engineSecret = deps.engineSecret ?? cfg!.engineSecret;
  const timeoutMs = deps.timeoutMs ?? cfg!.engineTimeoutMs;
  const doFetch = deps.fetchImpl ?? fetch;

  const form = new FormData();
  form.append("file", file, filename);
  const headers: Record<string, string> = { Accept: "application/x-ndjson" };
  if (engineSecret) headers["X-Engine-Secret"] = engineSecret;
  if (overrides.backend) headers["X-Backend"] = overrides.backend;
  if (overrides.model) headers["X-Model"] = overrides.model;
  if (overrides.anthropicKey) headers["X-Anthropic-Key"] = overrides.anthropicKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await doFetch(`${engineUrl}/extract`, { method: "POST", body: form, headers, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new EngineTimeout(`engine did not respond within ${timeoutMs}ms`);
    throw new EngineUnavailable(`engine unreachable: ${(err as Error).name}`);
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 200 || !response.body) {
    const text = await response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try { body = JSON.parse(text); } catch { body = { detail: text }; }
    return { status: response.status, stream: null, body, retryAfter: response.headers.get("retry-after") };
  }
  return { status: 200, stream: response.body, body: null, retryAfter: null };
}
