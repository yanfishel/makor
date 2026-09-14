import { describe, expect, it } from "vitest";
import { IdleTimeout, readNdjson } from "@/lib/ndjson";

function stream(chunks: string[], delayMs = 0, onCancel?: () => void): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) return controller.close();
      const chunk = chunks[i++];
      return new Promise<void>((r) => setTimeout(() => {
        // A cancel() that lands between this pull's schedule and its fire (the early-break
        // test below) leaves the controller closed by the time we get here — that is the
        // cancellation working as intended, not a bug in readNdjson, so swallow it.
        try { controller.enqueue(enc.encode(chunk)); } catch { /* cancelled mid-flight */ }
        r();
      }, delayMs));
    },
    cancel() { onCancel?.(); },
  });
}

async function collect(body: ReadableStream<Uint8Array>, idleMs?: number) {
  const out: unknown[] = [];
  for await (const e of readNdjson(body, idleMs)) out.push(e);
  return out;
}

describe("readNdjson", () => {
  it("splits lines that straddle chunk boundaries", async () => {
    const out = await collect(stream(['{"type":"a"}\n{"ty', 'pe":"b"}\n', '{"type":"c"}']));
    expect(out).toEqual([{ type: "a" }, { type: "b" }, { type: "c" }]);
  });
  it("ignores blank lines and a trailing newline", async () => {
    expect(await collect(stream(['{"type":"a"}\n\n', "\n"]))).toEqual([{ type: "a" }]);
  });
  it("throws IdleTimeout when no chunk arrives within idleMs", async () => {
    await expect(collect(stream(['{"type":"a"}\n', '{"type":"b"}\n'], 80), 30)).rejects.toBeInstanceOf(IdleTimeout);
  });
  it("does not time out while chunks keep arriving", async () => {
    // Each gap (~40ms) stays well under idleMs (60), but the total (~160ms) comfortably
    // exceeds it — proving idleMs resets per chunk rather than bounding the whole stream
    // (a real extraction runs 78s of exactly this pacing and must never be cut off).
    const chunks = ['{"type":"a"}\n', '{"type":"b"}\n', '{"type":"c"}\n', '{"type":"d"}\n'];
    expect(await collect(stream(chunks, 40), 60)).toHaveLength(4);
  });
  it("cancels the source stream when the consumer stops early", async () => {
    let cancelled = false;
    const s = stream(['{"type":"a"}\n', '{"type":"b"}\n'], 0, () => { cancelled = true; });
    for await (const e of readNdjson(s)) {
      if (e.type === "a") break;
    }
    expect(cancelled).toBe(true);
  });
});
