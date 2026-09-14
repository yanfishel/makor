import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatTiles } from "@/components/StatTiles";

describe("StatTiles", () => {
  it("renders a ledger row: numbers in mono, text values in sans with the hint on its own line", () => {
    const html = renderToStaticMarkup(createElement(StatTiles, { tiles: [{ label: "Documents", value: "5" }, { label: "Mode", value: "Your key", hint: "billed by Anthropic", text: true }, { label: "Latency", value: "21.3 s", hint: "median" }] }));
    expect(html).toContain("<dl");
    expect(html).toMatch(/<dd[^>]*font-mono[^>]*><span>5<\/span><\/dd>/);
    expect(html).toMatch(/<dd[^>]*font-sans[^>]*>Your key<\/dd>/);
    expect(html).toMatch(/<dd[^>]*text-muted-foreground[^>]*>billed by Anthropic<\/dd>/);
    // Value and hint are separate flex items: as one text run RTL fuses "21.3 s" and a numeric hint into one digit run.
    expect(html).toMatch(/<dd[^>]*flex[^>]*><span>21.3 s<\/span><span[^>]*>median<\/span><\/dd>/);
  });
  it("lays five tiles out in five columns on wide screens", () => {
    const tiles = ["a", "b", "c", "d", "e"].map((label) => ({ label, value: "1" }));
    expect(renderToStaticMarkup(createElement(StatTiles, { tiles }))).toContain("md:grid-cols-5");
    expect(renderToStaticMarkup(createElement(StatTiles, { tiles: tiles.slice(0, 4) }))).toContain("md:grid-cols-4");
  });
});
