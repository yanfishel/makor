/** Newline-delimited JSON, read line by line from a body stream. Shared by the server (the
 * engine's stream) and the browser (the web app's) — no Node imports. `idleMs` bounds the
 * wait for the NEXT chunk, not the whole stream: a pipeline speaks every few tens of
 * seconds, so silence past the engine timeout means the engine is gone. */
export class IdleTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new IdleTimeout(`no data for ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export async function* readNdjson(body: ReadableStream<Uint8Array>, idleMs?: number): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const chunk = idleMs ? await withTimeout(reader.read(), idleMs) : await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line);
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) yield JSON.parse(rest);
  } finally {
    // Every exit route — throw, normal completion, and a consumer's early `break` (which
    // resumes the generator via `.return()` and unwinds through `finally`, never `catch`) —
    // must leave the source stream cancelled, not just unlocked: an early break is the
    // natural way to consume this generator. Cancel before releasing the lock (the reverse
    // order throws); cancelling an already-done or already-cancelled stream is a no-op.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
