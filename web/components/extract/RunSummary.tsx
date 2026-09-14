"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { ExtractState } from "@/lib/extract-stream";
import { StageTable } from "./StageTable";

/** The run, in two columns above the warnings and the fields: what the engine is doing, and
 * how long it has been doing it.
 *
 * Left, the stages with their own timings (StageTable); right, the wall clock from the first
 * byte uploaded, ticking while the engine works. The clock's column is a fixed width rather
 * than one that shrinks to its text: the gap between the two would otherwise open and close
 * as the number grows a digit, and the stage table would shift with it. The document's own
 * facts — its type, its verdict, the response — belong to the result and live with it
 * (components/ResultView.tsx), not to the run.
 */
export function RunSummary({ state }: { state: ExtractState }) {
  const t = useTranslations("extract");
  const running = state.stage !== "done" && state.stage !== "error" && state.stage !== "idle";
  // Ticks while the engine works and freezes where it stopped. `startedAt` is the client's
  // own clock, so a re-render after `done` cannot walk the frozen number forward.
  const [now, setNow] = useState(state.startedAt);
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running, state.startedAt]);
  return (
    <div className="grid grid-cols-[1fr_8rem] gap-4">
      <StageTable state={state} />
      <span data-slot="clock" dir="ltr" className="text-end font-mono text-3xl leading-none tabular-nums" aria-label={t("elapsed")}>
        {((Math.max(now, state.startedAt) - state.startedAt) / 1000).toFixed(1)}s
      </span>
    </div>
  );
}
