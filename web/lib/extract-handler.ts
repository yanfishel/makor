import { AuthError, type Principal } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/crypto";
import { finishDocument, newDocumentId, pendingWindowMs, recordDocument, reserveTrial, startDocument, trialUsed } from "@/lib/documents";
import { EngineTimeout, EngineUnavailable, extractWithEngine, type EngineOverrides, type EngineUsage } from "@/lib/engine";
import { costUsd } from "@/lib/pricing";
import { apiError, json } from "@/lib/http";
import { decideMode } from "@/lib/mode";
import { engineChoice } from "@/lib/engine-label";
import { checkRegistries, REGISTRIES_UNAVAILABLE, summarizeCheck, type RegistriesResult } from "@/lib/registries/check";
import { getSettings } from "@/lib/settings";
import { getUser, isUnlimited } from "@/lib/users";
import { rateLimited, type ReadDeps } from "@/lib/usage-handlers";

// `settings.ts` exports no `Settings` type, only the row shape via `getSettings`'s return.
type Settings = ReturnType<typeof getSettings>;

export interface HandlerDeps extends ReadDeps { engine: typeof extractWithEngine }

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Accepted uploads: any image, or a PDF (the engine renders its first page). */
export const ACCEPTED_TYPES = /^(image\/|application\/pdf$)/;

export interface Prepared {
  principal: Principal; settings: Settings; mode: string; unlimited: boolean;
  file: Blob; filename: string; overrides: EngineOverrides; documentId: string;
  windowMs: number; now: () => Date;
  /** Whether this request runs the registries check: the request's own `check_registries` field, else the owner's setting. */
  checkRegistries: boolean;
  /** Closes the `documents` row. Every path calls it exactly once. */
  finish: (status: number, extra: Record<string, unknown>) => void;
}
export type Preparation = { reject: Response; prep?: undefined } | { prep: Prepared; reject?: undefined };
export interface Failure { status: number; error: string; detail: string; headers: Record<string, string> }

/** Everything an extraction does before the engine is called — principal, mode, upload
 * checks, overrides, the trial reservation or the pending row — shared by the one-shot
 * /api/v1/extract and the streaming /api/extract/stream. A rejection is already a full
 * Response with its row recorded. */
export async function prepareExtract(request: Request, deps: ReadDeps): Promise<Preparation> {
  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const windowMs = pendingWindowMs(deps.config.engineTimeoutMs);

  let principal: Principal;
  try {
    principal = await deps.principal(request);
  } catch (err) {
    if (err instanceof AuthError) return { reject: apiError(err.status, err.code, err.message) };
    throw err;
  }

  /** A pre-engine rejection: records a `documents` row (no filename/size/hash) and returns the error body. */
  const reject = (status: number, code: string, detail: string | undefined, mode: string, extra: Record<string, unknown> = {}): Preparation => {
    recordDocument(deps.db, {
      id: newDocumentId(),
      userId: principal.userId,
      createdAt: now().toISOString(),
      status,
      errorCode: code,
      mode,
      source: principal.via === "api" ? "api" : "ui",
      apiKeyId: principal.apiKeyId,
      latencyMs: Date.now() - started,
    });
    return { reject: apiError(status, code, detail, extra) };
  };

  const settings = getSettings(deps.db, principal.userId);
  const hasByokKey = Boolean(settings.anthropicKeyEnc);
  const used = deps.config.authMode === "clerk" && !hasByokKey ? trialUsed(deps.db, principal.userId, now(), windowMs) : 0;
  // Admins (and users an admin exempted) run on the server's own Anthropic key with no cap:
  // still `mode: "trial"` for accounting, but no reservation and no remaining count.
  const unlimited = isUnlimited(getUser(deps.db, principal.userId));
  const mode = decideMode({ authMode: deps.config.authMode, hasByokKey, trialUsed: used, trialDocs: deps.config.trialDocs, unlimited });
  if (mode === "exhausted") {
    return reject(402, "TRIAL_EXHAUSTED", undefined, "trial", { trial_docs: deps.config.trialDocs, hint: "Add your Anthropic API key in settings to continue" });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reject(400, "NO_FILE", "multipart body with a `file` part expected", mode);
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return reject(400, "NO_FILE", "`file` part missing", mode);
  if (file.size > MAX_UPLOAD_BYTES) return reject(413, "TOO_LARGE", "File too large (max 30 MB)", mode);
  if (file.type && !ACCEPTED_TYPES.test(file.type)) return reject(400, "NOT_IMAGE", "File is not an image or a PDF", mode);
  const filename = file instanceof File ? file.name : "upload";

  // The request's own flag outranks the owner's setting in both directions; absent, the setting decides.
  const flag = form.get("check_registries");
  if (flag !== null && flag !== "true" && flag !== "false") return reject(400, "INVALID_BODY", "check_registries must be true or false", mode);
  const checkRegistries = flag === null ? settings.checkRegistries : flag === "true";

  // The same choice the extract page prints under its heading (lib/engine-label.ts): what
  // reads the document and what the user was told would read it cannot be two decisions.
  const overrides: EngineOverrides = {};
  const choice = engineChoice(settings, deps.config.authMode);
  const resolvedBackend = choice.backend ?? undefined;
  if (resolvedBackend) overrides.backend = resolvedBackend;
  if (choice.model) overrides.model = choice.model;
  // The key only ever helps the anthropic backend. In none mode with no backend chosen,
  // the engine's own default is unknown to us, so the key still travels (it may go unused).
  const keyMayBeUsed = resolvedBackend !== "ollama";
  if (keyMayBeUsed && settings.anthropicKeyEnc && (mode === "byok" || mode === "local")) {
    try {
      overrides.anthropicKey = decrypt(settings.anthropicKeyEnc, deps.masterKey);
    } catch {
      return reject(500, "KEY_DECRYPT_FAILED", "Stored Anthropic key cannot be decrypted — the master key changed; remove and re-enter the key in settings", mode);
    }
  }

  const documentId = newDocumentId();
  const base = {
    id: documentId, userId: principal.userId, createdAt: now().toISOString(), mode,
    source: principal.via === "api" ? ("api" as const) : ("ui" as const), apiKeyId: principal.apiKeyId,
    backend: overrides.backend ?? null, model: overrides.model ?? null,
  };
  if (mode === "trial" && !unlimited) {
    if (!reserveTrial(deps.db, principal.userId, deps.config.trialDocs, base, now(), windowMs)) {
      return reject(402, "TRIAL_EXHAUSTED", undefined, "trial", { trial_docs: deps.config.trialDocs, hint: "Add your Anthropic API key in settings to continue" });
    }
  } else {
    startDocument(deps.db, base);
  }
  const finish = (status: number, extra: Record<string, unknown>) =>
    finishDocument(deps.db, documentId, { status, latencyMs: Date.now() - started, ...extra });
  return { prep: { principal, settings, checkRegistries, mode, unlimited, file, filename, overrides, documentId, windowMs, now, finish } };
}

/** A non-200 engine answer → the client's error, the row finished. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function failEngine(prep: Prepared, result: { status: number; body: any; retryAfter: string | null }): Failure {
  const detail = result.body?.detail;
  if (result.status === 502 && detail && typeof detail === "object" && detail.anthropic_status === 401) {
    prep.finish(400, { errorCode: "ANTHROPIC_KEY_INVALID" });
    return { status: 400, error: "ANTHROPIC_KEY_INVALID", detail: "Anthropic rejected the API key saved in settings", headers: {} };
  }
  if (result.status === 401 || result.status === 403) {
    prep.finish(502, { errorCode: "ENGINE_MISCONFIGURED" });
    return { status: 502, error: "ENGINE_MISCONFIGURED", detail: "Engine rejected the web app's secret — check ENGINE_SECRET / MAKOR_ENGINE_SECRET", headers: {} };
  }
  prep.finish(result.status, { errorCode: "ENGINE_ERROR" });
  return { status: result.status, error: "ENGINE_ERROR", detail: typeof detail === "string" ? detail : JSON.stringify(detail ?? result.body),
    headers: result.retryAfter ? { "retry-after": result.retryAfter } : {} };
}

/** The engine could not be reached or answered too late → the client's error, the row finished. */
export function failTransport(prep: Prepared, err: unknown): Failure {
  if (err instanceof EngineTimeout) {
    prep.finish(504, { errorCode: "ENGINE_TIMEOUT" });
    return { status: 504, error: "ENGINE_TIMEOUT", detail: "Extraction did not finish in time, retry later", headers: {} };
  }
  if (err instanceof EngineUnavailable) {
    prep.finish(503, { errorCode: "ENGINE_UNAVAILABLE" });
    return { status: 503, error: "ENGINE_UNAVAILABLE", detail: "Extraction engine unreachable, retry later", headers: {} };
  }
  // Any other throw (e.g. a network reset mid-body in engine.ts) must not leave the
  // reserved row pinned at PENDING_STATUS — close it out before Next turns this into a 500.
  prep.finish(500, { errorCode: "INTERNAL" });
  console.error(`extract internal error id=${prep.documentId}: ${(err as Error).message}`);
  return { status: 500, error: "INTERNAL", detail: "Unexpected error, retry later", headers: {} };
}

/** A 200 engine body → the API response (meta, cost, stored result), the row finished at
 * 200 — or at 500 when the bookkeeping itself throws, so the row never stays pending. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function completeExtract(deps: ReadDeps, prep: Prepared, body: Record<string, any>): { response: Record<string, unknown> } | { failure: Failure } {
  const { usage = [], ...payload } = body as { usage?: EngineUsage[] } & Record<string, unknown>;
  const [backend, ...modelParts] = String(payload.model ?? "").split("/");
  const model = modelParts.join("/") || null;

  // Everything from here on can throw (encrypt, trialUsed) after the row was already
  // reserved/started — an unhandled throw must still close the row out, not leave it pending.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = payload as Record<string, any>;
    const remaining = prep.mode === "trial" && !prep.unlimited ? Math.max(deps.config.trialDocs - trialUsed(deps.db, prep.principal.userId, prep.now(), prep.windowMs), 0) : null;

    // The registries check is the owner's opt-in (or this request's flag) and never costs an
    // extraction: any failure becomes REGISTRIES_UNAVAILABLE and one log line with the document
    // id — never a value.
    let registries: RegistriesResult | null = null;
    if (prep.checkRegistries) {
      try {
        if (!deps.registriesDb) throw new Error("no registries database in deps");
        registries = checkRegistries(deps.registriesDb(), p, prep.now().toISOString().slice(0, 10));
      } catch (err) {
        console.error(`registries check failed id=${prep.documentId}: ${(err as Error).message}`);
        registries = { error: REGISTRIES_UNAVAILABLE };
      }
    }

    const response = { ...payload, registries, meta: { mode: prep.mode, trial_remaining: remaining, backend: backend || null, model, document_id: prep.documentId } };

    prep.finish(200, {
      docType: p.document_type ?? null,
      verdict: p.validation?.overall ?? null,
      sefach: p.sefach != null,
      backend: backend || null, model,
      tokensIn: usage.reduce((n: number, u: EngineUsage) => n + (u.input_tokens ?? 0), 0),
      tokensOut: usage.reduce((n: number, u: EngineUsage) => n + (u.output_tokens ?? 0), 0),
      tokensCached: usage.reduce((n: number, u: EngineUsage) => n + (u.cache_read_tokens ?? 0), 0),
      costUsd: costUsd(usage),
      registries: registries ? JSON.stringify(summarizeCheck(registries)) : null,
      resultEnc: prep.settings.storeResults ? encrypt(JSON.stringify(response), deps.masterKey) : null,
    });
    return { response };
  } catch (err) {
    prep.finish(500, { errorCode: "INTERNAL" });
    console.error(`extract internal error id=${prep.documentId}: ${(err as Error).message}`);
    return { failure: { status: 500, error: "INTERNAL", detail: "Unexpected error, retry later", headers: {} } };
  }
}

/** Everything a client of POST /api/v1/extract sees goes through here; the route file only wires deps. */
export async function handleExtract(request: Request, deps: HandlerDeps): Promise<Response> {
  // The principal first, then its request budget — a refused request records no row and reserves no trial document.
  let principal: Principal;
  try {
    principal = await deps.principal(request);
  } catch (err) {
    if (err instanceof AuthError) return apiError(err.status, err.code, err.message);
    throw err;
  }
  const limited = rateLimited(deps, principal, "api");
  if (limited) return limited;

  const prepared = await prepareExtract(request, { ...deps, principal: async () => principal });
  if (prepared.reject) return prepared.reject;
  const { prep } = prepared;

  let result;
  try {
    result = await deps.engine(prep.file, prep.filename, prep.overrides);
  } catch (err) {
    const f = failTransport(prep, err);
    return json(f.status, { error: f.error, detail: f.detail });
  }

  if (result.status !== 200) {
    const f = failEngine(prep, result);
    return json(f.status, { error: f.error, detail: f.detail }, f.headers);
  }

  const done = completeExtract(deps, prep, result.body);
  if ("failure" in done) return json(done.failure.status, { error: done.failure.error, detail: done.failure.detail });
  return json(200, done.response);
}
