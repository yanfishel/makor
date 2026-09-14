"use client";
import { Check, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ExtractState, Stage } from "@/lib/extract-stream";
import { cn } from "@/lib/utils";

// Merge and validate are one row: no event separates them (the engine reports one timing for
// the pair) and a row that can never carry a number of its own is a row that says nothing.
const ITEMS = ["detect", "classify", "read", "mergeValidate"] as const;
type Item = (typeof ITEMS)[number];
/** Which item each stage is working on; merge and validate have no event between them. */
const ACTIVE: Partial<Record<Stage, Item>> = { uploading: "detect", detecting: "detect", classifying: "classify", reading: "read", merging: "mergeValidate" };
type ItemState = "pending" | "active" | "done" | "failed";

/** `errorAt` is the stage that was RUNNING when the engine failed (`state.error.at`):
 * `"error"` itself overwrites `state.stage`, so without it every item would read
 * "pending" — the table resetting to "nothing happened" instead of showing where it broke. */
function itemState(stage: Stage, item: Item, errorAt?: Stage): ItemState {
  if (stage === "done") return "done";
  const active = ACTIVE[stage === "error" ? (errorAt ?? "detecting") : stage];
  const at = active ? ITEMS.indexOf(active) : -1;
  const j = ITEMS.indexOf(item);
  if (stage === "error") return j < at ? "done" : j === at ? "failed" : "pending";
  return j < at ? "done" : j === at ? "active" : "pending";
}

// No space before the unit: these are readings in a narrow column, and "9.5 s" wrapped there
// once. The elapsed counter beside the table is written the same way.
const seconds = (ms: number | undefined) => (ms === undefined ? null : `${(ms / 1000).toFixed(1)}s`);

/** The pipeline's stages, one per row: where the engine is (icon), what it is working
 * through (2/2 frames classified, 1/2 read) and the engine's OWN timing for that stage in
 * its own cell. The wall clock belongs to the run, not to a stage — it is the counter in
 * RunSummary beside this table. */
export function StageTable({ state }: { state: ExtractState }) {
  const t = useTranslations("extract.stages");
  const counts: Partial<Record<Item, string | null>> = {
    classify: state.candidates ? `${state.classified}/${state.candidates}` : null,
    read: state.toRead.length ? `${state.readCount}/${state.toRead.length}` : null,
  };
  const timing: Partial<Record<Item, string | null>> = {
    detect: seconds(state.timings.detect),
    classify: seconds(state.timings.classify),
    read: seconds(state.timings.read),
    mergeValidate: seconds(state.timings.merge),
  };
  return (
    <table data-stage={state.stage} className="w-full font-mono text-xs" aria-live="polite">
      <tbody>
        {ITEMS.map((item) => {
          const s = itemState(state.stage, item, state.error?.at);
          return (
            <tr key={item} data-item={item} data-state={s}
              className={cn(s === "done" && "text-success", s === "active" && "text-foreground", s === "failed" && "text-destructive", s === "pending" && "text-muted-foreground")}>
              <td className="py-1 pe-4">
                <span className="flex items-center gap-1.5">
                  {s === "done" ? <Check className="size-3.5" /> : s === "active" ? <Loader2 className="size-3.5 animate-spin text-highlight" /> : s === "failed" ? <X className="size-3.5" /> : <span className="size-3.5 rounded-full border" />}
                  {t(item)}
                  {counts[item] && <span className="tabular-nums text-muted-foreground">{counts[item]}</span>}
                </span>
              </td>
              {/* "0.1 s" is a number and a Latin unit: in a Hebrew page the pair is reordered
                  into "s 0.1" unless the whole reading is isolated as LTR. */}
              <td className="py-1 text-end tabular-nums text-muted-foreground"><span dir="ltr">{timing[item]}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
