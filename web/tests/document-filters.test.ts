import { describe, expect, it } from "vitest";
import { filtersHref, parseFilters } from "@/lib/document-filters";

describe("parseFilters", () => {
  it("maps the query names to filter keys and drops empty values", () => {
    expect(parseFilters({ type: "cheque", verdict: "", status: "ok", engine: "ollama", source: "api", from: "2026-09-01", to: "2026-09-10" }))
      .toEqual({ family: "cheque", status: "ok", backend: "ollama", source: "api", from: "2026-09-01", to: "2026-09-10" });
    expect(parseFilters({})).toEqual({});
  });
  it("takes the first value of a repeated parameter", () => {
    expect(parseFilters({ type: ["cheque", "other"] })).toEqual({ family: "cheque" });
  });
  it("ignores an unknown status and a malformed date", () => {
    expect(parseFilters({ status: "weird", from: "yesterday", to: "2026-9-1" })).toEqual({});
  });
});

describe("filtersHref", () => {
  it("is the bare list path without filters or page", () => {
    expect(filtersHref({})).toBe("/app/documents");
    expect(filtersHref({}, 1)).toBe("/app/documents");
  });
  it("serialises the active filters under their query names, page last", () => {
    expect(filtersHref({ family: "cheque", backend: "ollama" }, 3)).toBe("/app/documents?type=cheque&engine=ollama&page=3");
    expect(filtersHref({ from: "2026-09-01" })).toBe("/app/documents?from=2026-09-01");
  });
});
