import { describe, expect, it } from "vitest";

describe("next.config", () => {
  it("lets a 30 MB upload through the middleware body buffer", async () => {
    // Next 15.5 buffers the request body so middleware can clone it, 10 MB by default:
    // a 12 MB scan reached /api/v1/extract truncated ("Request body exceeded 10MB ...").
    const config = (await import("../next.config")).default as { experimental?: { middlewareClientMaxBodySize?: string | number } };
    expect(config.experimental?.middlewareClientMaxBodySize).toBe("32mb");
  });
});
