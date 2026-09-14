import { AuthError, type Principal } from "@/lib/auth";
import { EngineTimeout, EngineUnavailable, type EngineStreamResult, type extractStreamWithEngine } from "@/lib/engine";
import { completeExtract, failEngine, failTransport, prepareExtract, type Failure, type Prepared } from "@/lib/extract-handler";
import { apiError } from "@/lib/http";
import { IdleTimeout, readNdjson } from "@/lib/ndjson";
import type { ReadDeps } from "@/lib/usage-handlers";

export interface StreamDeps extends ReadDeps { engineStream: typeof extractStreamWithEngine }

/** The live form of an extraction for the signed-in UI: the engine's NDJSON events
 * forwarded line by line, `done` rewritten into the same response /api/v1/extract
 * returns, every failure as one `error` line (the browser's fetch is already open, so
 * an HTTP status cannot carry it). Session-only; an API key gets 403 like /api/keys. */
export async function handleExtractStream(request: Request, deps: StreamDeps): Promise<Response> {
  let principal: Principal;
  try {
    principal = await deps.principal(request);
  } catch (err) {
    if (err instanceof AuthError) return apiError(err.status, err.code, err.message);
    throw err;
  }
  if (principal.via === "api") return apiError(403, "SESSION_REQUIRED", "Sign in to use the live extraction");

  const prepared = await prepareExtract(request, { ...deps, principal: async () => principal });
  if (prepared.reject) return prepared.reject;
  const { prep } = prepared;

  const encoder = new TextEncoder();
  const line = (event: unknown) => encoder.encode(JSON.stringify(event) + "\n");
  const errorLine = (f: Failure) => line({ type: "error", error: f.error, detail: f.detail });
  const respond = (body: BodyInit) => new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });

  let engine: EngineStreamResult;
  try {
    engine = await deps.engineStream(prep.file, prep.filename, prep.overrides);
  } catch (err) {
    return respond(errorLine(failTransport(prep, err)));
  }
  if (engine.status !== 200 || !engine.stream) return respond(errorLine(failEngine(prep, engine)));

  const source = engine.stream;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: unknown) => { if (!open) return; try { controller.enqueue(line(event)); } catch { open = false; } };
      const close = () => { if (!open) return; open = false; try { controller.close(); } catch { /* already closed */ } };
      void pump(source, deps, prep, push, close);
    },
    cancel() {
      // The client went away. The pump keeps draining the engine so the row closes
      // with its true status, tokens and cost; nothing more is enqueued.
      open = false;
    },
  });
  return respond(stream);
}

async function pump(source: ReadableStream<Uint8Array>, deps: StreamDeps, prep: Prepared, push: (event: unknown) => void, close: () => void): Promise<void> {
  let finished = false;
  // `stamp` carries the engine's own `seq`/`t` onto a line this proxy rebuilds rather than
  // forwards verbatim, so every line the client sees — `done` included — sits on the
  // engine's one monotonic clock; omitted when no incoming engine event backs the failure
  // (the stream ended, or the engine was never reached).
  const fail = (f: Failure, stamp?: { seq: number; t: number }) => { finished = true; push({ type: "error", error: f.error, detail: f.detail, ...(stamp ?? {}) }); };
  try {
    for await (const event of readNdjson(source, deps.config.engineTimeoutMs)) {
      if (event.type === "done") {
        const stamp = { seq: Number(event.seq), t: Number(event.t) };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const done = completeExtract(deps, prep, event.result as Record<string, any>);
        finished = true;
        if ("failure" in done) push({ type: "error", error: done.failure.error, detail: done.failure.detail, ...stamp });
        else push({ type: "done", ...stamp, result: done.response });
        // A terminal event ends the stream here, on purpose: the row is finished exactly
        // once, so a second terminal line (an engine bug, a replaying proxy, a malformed
        // multi-document body) must never reach `completeExtract`/`fail` again. `return`
        // out of `for await` still runs `finally { close() }` below, and it drives the
        // generator's own `.return()`, which cancels `source` — the engine connection is
        // released rather than left half-read.
        return;
      } else if (event.type === "error") {
        fail(failEngine(prep, { status: Number(event.status) || 502, body: { detail: event.detail }, retryAfter: null }), { seq: Number(event.seq), t: Number(event.t) });
        return;
      } else {
        push(event);
      }
    }
    if (!finished) fail(failEngine(prep, { status: 502, body: { detail: "engine stream ended without a result" }, retryAfter: null }));
  } catch (err) {
    if (!finished) fail(failTransport(prep, err instanceof IdleTimeout ? new EngineTimeout(err.message) : new EngineUnavailable((err as Error).message)));
  } finally {
    close();
  }
}
