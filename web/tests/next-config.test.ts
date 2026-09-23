import { describe, expect, it } from "vitest";

describe("next.config", () => {
  it("lets a 30 MB upload through the middleware body buffer", async () => {
    // Next buffers the request body so middleware can clone it, 10 MB by default:
    // a 12 MB scan reached /api/v1/extract truncated ("Request body exceeded 10MB ...").
    const config = (await import("../next.config")).default as { experimental?: { proxyClientMaxBodySize?: string | number } };
    expect(config.experimental?.proxyClientMaxBodySize).toBe("32mb");
  });
});
