import type { SourceId, SourceStatus } from "@/lib/registries/db";

/** The sources the last run touched (started at or after `runStartedAt`), split by outcome. Client-safe: types only. */
export function summarizeRun(sources: SourceStatus[], runStartedAt: string | null): { ok: SourceId[]; failed: SourceId[] } {
  const touched = runStartedAt === null ? [] : sources.filter((s) => s.startedAt !== null && s.startedAt >= runStartedAt);
  return { ok: touched.filter((s) => s.status === "ok").map((s) => s.id), failed: touched.filter((s) => s.status !== "ok").map((s) => s.id) };
}
