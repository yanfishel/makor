import type { EngineUsage } from "@/lib/engine";

/** Anthropic list prices in USD per million tokens (first-party API; cached 2026-06-24 from the
 * claude-api reference). Cache reads are a tenth of the input rate and cache writes five quarters
 * of it on every model here; Fable's cache read is the one exception and is listed as published. */
interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }
const PER_MILLION = 1_000_000;
const price = (input: number, output: number, cacheRead = input / 10): Price => ({ input, output, cacheRead, cacheWrite: input * 1.25 });

/** The date of the price list below; shown next to every cost figure so staleness is visible.
 * Anthropic publishes no pricing API, so this table is updated by hand — from the claude-api
 * reference or https://www.anthropic.com/pricing — and the date bumped with it. */
export const PRICES_DATE = "2026-06-24";

export const PRICES: Record<string, Price> = {
  "claude-fable-5-1": price(10, 50, 0.25),
  "claude-fable-5": price(10, 50),
  "claude-opus-5": price(5, 25),
  "claude-opus-4-8": price(5, 25),
  "claude-opus-4-7": price(5, 25),
  "claude-opus-4-6": price(5, 25),
  "claude-sonnet-5": price(2, 10),
  "claude-sonnet-4-6": price(3, 15),
  "claude-haiku-4-5": price(1, 5),
};

/** Cost of one engine response in USD, priced per `usage[]` entry: a document can carry two
 * models (classifier + reader). Null when any entry cannot be priced — an Ollama call, a model
 * missing from the table, or no calls at all — never a partial sum that reads as a small bill. */
export function costUsd(usage: EngineUsage[]): number | null {
  if (usage.length === 0) return null;
  let total = 0;
  for (const u of usage) {
    const p = u.backend === "anthropic" ? PRICES[u.model] : undefined;
    if (!p) return null;
    total += ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output
      + (u.cache_read_tokens ?? 0) * p.cacheRead + (u.cache_write_tokens ?? 0) * p.cacheWrite) / PER_MILLION;
  }
  return total;
}
