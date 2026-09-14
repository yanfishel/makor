import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS } from "@/lib/redirects";

describe("LEGACY_REDIRECTS", () => {
  it("sends the old /docs, in every locale form, permanently to /api-reference", () => {
    const to = (source: string) => LEGACY_REDIRECTS.find((r) => r.source === source);
    expect(to("/docs")).toEqual({ source: "/docs", destination: "/api-reference", permanent: true });
    expect(to("/en/docs")).toEqual({ source: "/en/docs", destination: "/api-reference", permanent: true });
    expect(to("/he/docs")).toEqual({ source: "/he/docs", destination: "/he/api-reference", permanent: true });
  });
});
