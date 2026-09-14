/** Engine (ollama / anthropic) and source (web / api) chips: one token colour each, spelled out
 * in full so Tailwind emits the classes; an unknown value falls back to the neutral chip. */
const NEUTRAL = "border-border bg-muted text-muted-foreground";
const ENGINE: Record<string, string> = {
  ollama: "border-engine-ollama/25 bg-engine-ollama/10 text-engine-ollama",
  anthropic: "border-engine-anthropic/25 bg-engine-anthropic/10 text-engine-anthropic",
};
const SOURCE: Record<string, string> = {
  ui: "border-source-ui/25 bg-source-ui/10 text-source-ui",
  api: "border-source-api/25 bg-source-api/10 text-source-api",
};
export function engineChipClass(backend: string | null | undefined): string {
  return (backend && ENGINE[backend]) || NEUTRAL;
}
export function sourceChipClass(source: string | null | undefined): string {
  return (source && SOURCE[source]) || NEUTRAL;
}
