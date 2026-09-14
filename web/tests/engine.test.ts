import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { EngineTimeout, EngineUnavailable, extractStreamWithEngine, extractWithEngine } from "@/lib/engine";

let server: Server;
let url: string;
let lastHeaders: Record<string, string | string[] | undefined> = {};
let nextResponse: { status: number; body: string; headers?: Record<string, string>; delayMs?: number } = { status: 200, body: "{}" };

beforeAll(async () => {
  server = createServer((req, res) => {
    lastHeaders = req.headers;
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("latin1");
      lastHeaders["x-test-has-file"] = raw.includes('name="file"') ? "yes" : "no";
      const respond = () => {
        res.writeHead(nextResponse.status, { "content-type": "application/json", ...(nextResponse.headers ?? {}) });
        res.end(nextResponse.body);
      };
      if (nextResponse.delayMs) setTimeout(respond, nextResponse.delayMs);
      else respond();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => server.close());

const blob = () => new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" });

describe("extractWithEngine", () => {
  it("posts the file with the secret and override headers", async () => {
    nextResponse = { status: 200, body: JSON.stringify({ document_type: "teudat_zehut", usage: [] }) };
    const r = await extractWithEngine(blob(), "x.png", { backend: "anthropic", model: "claude-opus-5", anthropicKey: "sk-ant-u" },
      { engineUrl: url, engineSecret: "s3cret" });
    expect(r.status).toBe(200);
    expect(r.body.document_type).toBe("teudat_zehut");
    expect(lastHeaders["x-engine-secret"]).toBe("s3cret");
    expect(lastHeaders["x-backend"]).toBe("anthropic");
    expect(lastHeaders["x-model"]).toBe("claude-opus-5");
    expect(lastHeaders["x-anthropic-key"]).toBe("sk-ant-u");
    expect(lastHeaders["x-test-has-file"]).toBe("yes");
  });
  it("omits headers that are not given", async () => {
    nextResponse = { status: 200, body: "{}" };
    await extractWithEngine(blob(), "x.png", {}, { engineUrl: url, engineSecret: "" });
    expect(lastHeaders["x-engine-secret"]).toBeUndefined();
    expect(lastHeaders["x-backend"]).toBeUndefined();
    expect(lastHeaders["x-anthropic-key"]).toBeUndefined();
  });
  it("passes error statuses and Retry-After through", async () => {
    nextResponse = { status: 503, body: JSON.stringify({ detail: "busy" }), headers: { "retry-after": "30" } };
    const r = await extractWithEngine(blob(), "x.png", {}, { engineUrl: url });
    expect(r).toMatchObject({ status: 503, body: { detail: "busy" }, retryAfter: "30" });
  });
  it("wraps a non-JSON body", async () => {
    nextResponse = { status: 502, body: "Bad Gateway" };
    const r = await extractWithEngine(blob(), "x.png", {}, { engineUrl: url });
    expect(r.body).toEqual({ detail: "Bad Gateway" });
  });
  it("throws EngineUnavailable when the engine is down", async () => {
    await expect(extractWithEngine(blob(), "x.png", {}, { engineUrl: "http://127.0.0.1:1" })).rejects.toBeInstanceOf(EngineUnavailable);
  });
  it("throws EngineTimeout when the engine is slower than timeoutMs", async () => {
    nextResponse = { status: 200, body: "{}", delayMs: 200 };
    await expect(extractWithEngine(blob(), "x.png", {}, { engineUrl: url, engineSecret: "", timeoutMs: 50 })).rejects.toBeInstanceOf(EngineTimeout);
  });
});

describe("extractStreamWithEngine", () => {
  it("asks for NDJSON and hands back the body stream on 200", async () => {
    nextResponse = { status: 200, body: '{"type":"page","seq":1,"t":0}\n{"type":"done","seq":2,"t":5,"result":{}}\n', headers: { "content-type": "application/x-ndjson" } };
    const r = await extractStreamWithEngine(blob(), "x.png", { backend: "ollama" }, { engineUrl: url, engineSecret: "s3cret", timeoutMs: 1000 });
    expect(r.status).toBe(200);
    expect(lastHeaders["accept"]).toBe("application/x-ndjson");
    expect(lastHeaders["x-engine-secret"]).toBe("s3cret");
    expect(lastHeaders["x-backend"]).toBe("ollama");
    const text = await new Response(r.stream!).text();
    expect(text.split("\n").filter(Boolean)).toHaveLength(2);
    expect(r.body).toBeNull();
  });
  it("returns the parsed error body and no stream on a non-200", async () => {
    nextResponse = { status: 503, body: JSON.stringify({ detail: "busy" }), headers: { "retry-after": "30" } };
    const r = await extractStreamWithEngine(blob(), "x.png", {}, { engineUrl: url, engineSecret: "", timeoutMs: 1000 });
    expect(r).toEqual({ status: 503, stream: null, body: { detail: "busy" }, retryAfter: "30" });
  });
  it("throws EngineUnavailable when the engine cannot be reached", async () => {
    await expect(extractStreamWithEngine(blob(), "x.png", {}, { engineUrl: "http://127.0.0.1:1", engineSecret: "", timeoutMs: 1000 })).rejects.toBeInstanceOf(EngineUnavailable);
  });
  it("throws EngineTimeout when the headers do not arrive in time", async () => {
    nextResponse = { status: 200, body: "{}", delayMs: 300 };
    await expect(extractStreamWithEngine(blob(), "x.png", {}, { engineUrl: url, engineSecret: "", timeoutMs: 50 })).rejects.toBeInstanceOf(EngineTimeout);
  });
});
