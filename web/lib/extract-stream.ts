import { fieldRows, type ExtractResponse, type Sefach } from "@/lib/result-types";
import { sefachRows } from "@/lib/sefach";

/* The events POST /api/extract/stream forwards (engine/app/main.py `_stream`), plus two local actions. */
export type Bbox = [number, number, number, number];
export type RegionStatus = "found" | "classified" | "reading" | "read" | "skipped" | "failed";
export interface FieldRow { name: string; value: string; confidence: string }

interface Stamped { seq: number; t: number }
export interface PageEvent extends Stamped { type: "page"; width: number; height: number; preview?: string }
export interface RegionsEvent extends Stamped { type: "regions"; regions: { i: number; bbox_2d: number[]; label: string; skipped: boolean }[] }
export interface ClassifiedEvent extends Stamped { type: "classified"; i: number | null; kind: string; sure: boolean }
export interface TriageEvent extends Stamped { type: "triage"; read: { i: number | null; dpi: number | null }[]; skipped: (number | null)[] }
export interface ReadingEvent extends Stamped { type: "reading"; i: number | null }
export interface ReadEvent extends Stamped { type: "read"; i: number | null; document_type: string; fields: Record<string, unknown>; sefach?: Sefach | null }
export interface NoteEvent extends Stamped { type: "note"; text: string }
export interface DoneEvent extends Stamped { type: "done"; result: ExtractResponse }
export interface ErrorEvent { type: "error"; error: string | null; detail: string }
export type StreamEvent = PageEvent | RegionsEvent | ClassifiedEvent | TriageEvent | ReadingEvent | ReadEvent | NoteEvent | DoneEvent | ErrorEvent
  | { type: "reset"; now: number; stage?: Stage } | { type: "start"; now: number };

export type Stage = "idle" | "uploading" | "detecting" | "classifying" | "reading" | "merging" | "done" | "error";
export interface RegionState { i: number; bbox: Bbox; label: string; status: RegionStatus; kind?: string; sure?: boolean; dpi?: number | null; docType?: string; fields?: FieldRow[] }
export interface WholeState { status: "reading" | "read" | "failed"; docType?: string; fields?: FieldRow[] }
export interface ExtractState {
  stage: Stage;
  startedAt: number;
  page?: { width: number; height: number; preview?: string };
  regions: RegionState[];
  whole?: WholeState;
  candidates: number;   // frames the classifier looks at (non-junk boxes, or the page itself)
  classified: number;
  toRead: (number | null)[];
  readCount: number;
  timings: { detect?: number; classify?: number; read?: number; merge?: number };
  marks: { page?: number; regions?: number; triage?: number; lastRead?: number };
  notes: string[];
  result?: ExtractResponse;
  error?: { code: string | null; detail: string; at: Stage };
}

export function initialState(now = Date.now(), stage: Stage = "uploading"): ExtractState {
  return { stage, startedAt: now, regions: [], candidates: 0, classified: 0, toRead: [], readCount: 0, timings: {}, marks: {}, notes: [] };
}

const UNREAD = /^Region (\d+) .*could not be read/;

function patch(state: ExtractState, i: number | null, change: Partial<RegionState> | ((r: RegionState) => Partial<RegionState>)): ExtractState {
  if (i === null) return state;
  return { ...state, regions: state.regions.map((r) => (r.i === i ? { ...r, ...(typeof change === "function" ? change(r) : change) } : r)) };
}

/** Pure: the page's state after one event. Region indices are the detector's (`i`); the
 * whole-page frame is `i: null` and lives in `whole`. */
export function applyEvent(state: ExtractState, event: StreamEvent): ExtractState {
  switch (event.type) {
    case "reset": return initialState(event.now, event.stage ?? "uploading");
    case "start": return { ...initialState(event.now), stage: "uploading" };
    case "page":
      return { ...state, stage: "detecting", page: { width: event.width, height: event.height, ...(event.preview ? { preview: event.preview } : {}) }, marks: { ...state.marks, page: event.t } };
    case "regions": {
      const regions = event.regions.map<RegionState>((r) => ({ i: r.i, bbox: r.bbox_2d as Bbox, label: r.label, status: r.skipped ? "skipped" : "found" }));
      // A provisional count of what will be classified — refined once "triage" lands,
      // since the engine caps classification at four frames (pipeline.py candidates[:4]):
      // a fifth plausible box would otherwise show "classify 4/5" forever.
      const candidates = regions.length ? regions.filter((r) => r.status !== "skipped").length : 1;
      return { ...state, stage: "classifying", regions, candidates, timings: { ...state.timings, detect: event.t - (state.marks.page ?? 0) }, marks: { ...state.marks, regions: event.t } };
    }
    case "classified": {
      const next = patch(state, event.i, (r) => ({ status: r.status === "found" ? "classified" : r.status, kind: event.kind, sure: event.sure }));
      return { ...next, classified: state.classified + 1, timings: { ...state.timings, classify: event.t - (state.marks.regions ?? event.t) } };
    }
    case "triage": {
      // By the time triage lands, classification is over: `state.classified` (one per
      // "classified" event already applied) is exactly how many frames were actually
      // classified, including a box beyond the classify cap that never got one. The
      // read-plus-skipped sum is only a fallback for MAKOR_CLASSIFY=off, where no
      // "classified" event is ever emitted and state.classified would otherwise read 0/0.
      const candidates = state.classified || (event.read.length + event.skipped.length);
      let next: ExtractState = { ...state, stage: "reading", toRead: event.read.map((r) => r.i), candidates, marks: { ...state.marks, triage: event.t } };
      for (const r of event.read) next = patch(next, r.i, { dpi: r.dpi });
      for (const i of event.skipped) next = patch(next, i, { status: "skipped" });
      return next;
    }
    case "reading":
      if (event.i === null) return { ...state, stage: "reading", whole: { status: "reading" } };
      return { ...patch(state, event.i, { status: "reading" }), stage: "reading" };
    case "read": {
      // A sefach frame publishes the SHEET's readings, not the card-shaped subset the merge
      // derives from it: the address, the status and the children are the point of the sheet.
      const fields = event.sefach ? sefachRows(event.sefach) : fieldRows(event.fields as ExtractResponse["fields"]);
      const status = event.document_type === "unreadable" ? "failed" : "read";
      const readCount = state.readCount + 1;
      const stage: Stage = readCount >= state.toRead.length ? "merging" : "reading";
      const timings = { ...state.timings, read: event.t - (state.marks.triage ?? event.t) };
      const marks = { ...state.marks, lastRead: event.t };
      if (event.i === null) return { ...state, stage, readCount, timings, marks, whole: { status, docType: event.document_type, fields } };
      return { ...patch(state, event.i, { status, docType: event.document_type, fields }), stage, readCount, timings, marks };
    }
    case "note": {
      const m = UNREAD.exec(event.text);
      if (!m) return { ...state, notes: [...state.notes, event.text] };
      // A region the engine gave up reading never gets a "read" event, only this note —
      // count the failure toward readCount exactly as a read would, so the bar does not
      // freeze at "read k/n" until `done` flips everything at once. Guarded by the
      // region's current status so a region is never counted twice.
      const i = Number(m[1]) - 1;
      const already = state.regions.find((r) => r.i === i)?.status === "failed";
      const readCount = already ? state.readCount : state.readCount + 1;
      const stage: Stage = readCount >= state.toRead.length ? "merging" : state.stage;
      return { ...patch(state, i, { status: "failed" }), stage, readCount, notes: [...state.notes, event.text] };
    }
    case "done":
      return { ...state, stage: "done", result: event.result, timings: { ...state.timings, merge: event.t - (state.marks.lastRead ?? event.t) } };
    case "error": {
      // A read that fails upstream sends no "read" or note for its frame, only this: whatever is
      // still "reading" failed with the run, or its scan beam sweeps on forever under the alert.
      const regions = state.regions.map((r) => (r.status === "reading" ? { ...r, status: "failed" as const } : r));
      const whole = state.whole?.status === "reading" ? { ...state.whole, status: "failed" as const } : state.whole;
      return { ...state, stage: "error", regions, whole, error: { code: event.error, detail: event.detail, at: state.stage } };
    }
    default:
      // `StreamEvent` is a closed union, but the events that reach this function arrive off
      // the network (`extract-stream-handler.ts` forwards every non-terminal engine line
      // verbatim) and TS cannot check a wire payload: an event type the engine adds and this
      // reducer does not yet model must be a no-op, not an implicit `undefined` that kills
      // the next `reduce` step's `state.regions` read and drops all accumulated state.
      return state;
  }
}
