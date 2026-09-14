import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

describe("theme tokens", () => {
  it("defines the status tokens in both themes and maps them for Tailwind", () => {
    for (const sel of [":root", ".dark"]) {
      const b = block(sel);
      for (const t of ["--success:", "--success-foreground:", "--warning:", "--warning-foreground:", "--destructive:", "--destructive-foreground:", "--primary:"]) expect(b, `${sel} ${t}`).toContain(t);
    }
    const theme = block("@theme inline");
    for (const t of ["--color-success:", "--color-warning:", "--color-destructive-foreground:", "--font-mono:"]) expect(theme).toContain(t);
  });
  it("adds the highlight and ink tokens in both themes and maps them", () => {
    for (const sel of [":root", ".dark"]) {
      const b = block(sel);
      for (const t of ["--highlight:", "--highlight-foreground:", "--ink:", "--ink-foreground:"]) expect(b, `${sel} ${t}`).toContain(t);
    }
    const theme = block("@theme inline");
    for (const t of ["--color-highlight:", "--color-highlight-foreground:", "--color-ink:", "--color-ink-foreground:"]) expect(theme).toContain(t);
  });
  it("defines a colour token per document family in both themes and maps them", () => {
    const families = ["teudat-zehut", "israeli-passport", "foreign-passport", "israeli-drivers-license", "disability-card", "senior-citizen-card", "weapon-license", "cheque"];
    for (const sel of [":root", ".dark"]) for (const f of families) expect(block(sel), `${sel} --doc-${f}`).toContain(`--doc-${f}:`);
    for (const f of families) expect(block("@theme inline")).toContain(`--color-doc-${f}:`);
  });
  it("defines the engine and source chip tokens in both themes and maps them", () => {
    for (const sel of [":root", ".dark"]) for (const t of ["--engine-ollama:", "--engine-anthropic:", "--source-ui:", "--source-api:"]) expect(block(sel), `${sel} ${t}`).toContain(t);
    for (const t of ["--color-engine-ollama:", "--color-engine-anthropic:", "--color-source-ui:", "--color-source-api:"]) expect(block("@theme inline")).toContain(t);
  });
  it("uses ink as the light primary and paper as the dark primary (hue ≈265, no indigo)", () => {
    expect(block(":root")).toMatch(/--primary: oklch\(0\.2\d [\d.]+ 26[0-9]\)/);
    expect(block(".dark")).toMatch(/--primary: oklch\(0\.9\d [\d.]+ 26[0-9]\)/);
    expect(css).not.toMatch(/27[67]\.\d+\)/);
  });
  it("gives every enabled button, tab and switch a pointer cursor and a disabled one the not-allowed cursor", () => {
    const base = css.slice(css.indexOf("@layer base"));
    expect(base).toMatch(/button:not\(:disabled\)[^{]*\{[^}]*cursor: pointer/);
    expect(base).toMatch(/\[role="tab"\][^{]*\{[^}]*cursor: pointer/);
    expect(base).toMatch(/button:disabled[^{]*\{[^}]*cursor: not-allowed/);
  });
  it("points on every enabled choice in a dropdown or select, and no ui component overrides it with cursor-default", () => {
    const base = css.slice(css.indexOf("@layer base"));
    for (const role of ["menuitem", "menuitemcheckbox", "menuitemradio", "option"]) {
      expect(base).toMatch(new RegExp(`\\[role="${role}"\\]:not\\(\\[data-disabled\\]\\)[^{]*\\{[^}]*cursor: pointer`));
    }
    for (const file of ["dropdown-menu.tsx", "select.tsx"]) {
      const src = readFileSync(path.resolve(__dirname, "../components/ui", file), "utf8");
      const items = src.split("function ").filter((f) => /^(DropdownMenu(Item|CheckboxItem|RadioItem|SubTrigger)|SelectItem)\b/.test(f));
      expect(items.length, file).toBeGreaterThan(0);
      for (const f of items) expect(f, f.slice(0, 30)).not.toContain("cursor-default");
    }
  });
  it("uses a 6 px radius", () => {
    expect(block(":root")).toContain("--radius: 0.375rem");
  });
  it("switches the sans font by language to IBM Plex Sans Hebrew", () => {
    expect(css).toContain('html[lang="he"]');
    expect(css).toContain("--font-plex-hebrew");
    expect(css).not.toContain("--font-heebo");
    expect(css).not.toContain("--font-inter");
  });
});
