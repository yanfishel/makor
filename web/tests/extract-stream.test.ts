import { describe, expect, it } from "vitest";
import { applyEvent, initialState, type ExtractState, type StreamEvent } from "@/lib/extract-stream";
import type { Sefach } from "@/lib/result-types";

const result = { document_type: "teudat_zehut", fields: {}, validation: { overall: "unverified" }, warnings: [], regions: [], sefach: null, model: "ollama/x",
  meta: { mode: "local", trial_remaining: null, backend: "ollama", model: "x", document_id: "d1" } };

const run = (events: StreamEvent[], start = initialState(1000)) => events.reduce(applyEvent, start);

const f = (value: string | null, confidence: "high" | "medium" | "low" = "high") => ({ value, confidence });
/** What the engine sends with a sefach frame's `read`: the sheet's own readings. */
const sheet: Sefach = {
  id_number: f("123456782"), last_name_he: f("כהן"), first_name_he: f("דוד"),
  previous_last_name_he: f(null), previous_first_name_he: f(null), maiden_name_he: f(null),
  father_name_he: f(null), mother_name_he: f(null), date_of_birth: f(null), place_of_birth: f(null),
  marital_status: f("גרוש"), nationality: f(null), date_of_issue: f(null),
  address: { street: null, house_number: null, entrance: null, apartment: null, city: "ירושלים", postal_code: null, confidence: "high" },
  spouse: null,
  children: [{ last_name_he: null, first_name_he: "רותי", id_number: "200000008", date_of_birth: null, sex: null, confidence: "high" }],
  notes: null, marital_status_code: "divorced",
};

const cardAndSefach: StreamEvent[] = [
  { type: "page", seq: 1, t: 2, width: 850, height: 1170 },
  { type: "regions", seq: 2, t: 120, regions: [{ i: 0, bbox_2d: [300, 0, 700, 180], label: "document", skipped: false }, { i: 1, bbox_2d: [150, 200, 900, 880], label: "sefach", skipped: false }, { i: 2, bbox_2d: [0, 950, 60, 990], label: "document", skipped: true }] },
  { type: "classified", seq: 3, t: 4300, i: 1, kind: "sefach", sure: true },
  { type: "classified", seq: 4, t: 4400, i: 0, kind: "teudat_zehut", sure: true },
  { type: "triage", seq: 5, t: 4500, read: [{ i: 0, dpi: 300 }, { i: 1, dpi: 300 }], skipped: [] },
  { type: "reading", seq: 6, t: 4501, i: 0 },
  { type: "read", seq: 7, t: 30000, i: 0, document_type: "teudat_zehut", fields: { id_number: { value: "123456782", confidence: "high" }, sex: { value: null, confidence: "low" } } },
  { type: "reading", seq: 8, t: 30001, i: 1 },
  { type: "note", seq: 9, t: 30002, text: "The image is about 100 dpi — below the recommended 150 dpi" },
  { type: "read", seq: 10, t: 60000, i: 1, document_type: "teudat_zehut_sefach", fields: { id_number: { value: "123456782", confidence: "high" } }, sefach: sheet },
  { type: "done", seq: 11, t: 61000, result },
];

describe("applyEvent", () => {
  it("gives a sefach frame the SHEET's readings, not the card-shaped fields derived from it", () => {
    const s = run(cardAndSefach.slice(0, 10));
    const sefachRegion = s.regions.find((r) => r.i === 1)!;
    expect(sefachRegion.status).toBe("read");
    expect(sefachRegion.fields?.map((f) => f.name)).toEqual([
      "id_number", "last_name_he", "first_name_he", "marital_status", "address.city",
      "children[0].first_name_he", "children[0].id_number",
    ]);
    // the card's own frame keeps the plain field shape
    expect(s.regions.find((r) => r.i === 0)?.fields?.map((f) => f.name)).toEqual(["id_number"]);
  });

  it("walks a card + sefach page from detecting to done", () => {
    const s = run(cardAndSefach.slice(0, 1));
    expect(s.stage).toBe("detecting");
    expect(s.page).toEqual({ width: 850, height: 1170 });

    const r = run(cardAndSefach.slice(0, 2));
    expect(r.stage).toBe("classifying");
    expect(r.regions.map((x) => x.status)).toEqual(["found", "found", "skipped"]);
    expect(r.candidates).toBe(2);
    expect(r.timings.detect).toBe(118);

    const c = run(cardAndSefach.slice(0, 4));
    expect(c.regions[0]).toMatchObject({ status: "classified", kind: "teudat_zehut", sure: true });
    expect(c.classified).toBe(2);
    expect(c.timings.classify).toBe(4280);

    const tr = run(cardAndSefach.slice(0, 5));
    expect(tr.stage).toBe("reading");
    expect(tr.toRead).toEqual([0, 1]);
    expect(tr.regions[0].dpi).toBe(300);

    const reading = run(cardAndSefach.slice(0, 6));
    expect(reading.regions[0].status).toBe("reading");

    const read = run(cardAndSefach.slice(0, 7));
    expect(read.regions[0]).toMatchObject({ status: "read", docType: "teudat_zehut", fields: [{ name: "id_number", value: "123456782", confidence: "high" }] });
    expect(read.readCount).toBe(1);
    expect(read.stage).toBe("reading");

    const noted = run(cardAndSefach.slice(0, 9));
    expect(noted.notes).toEqual(["The image is about 100 dpi — below the recommended 150 dpi"]);

    const merging = run(cardAndSefach.slice(0, 10));
    expect(merging.stage).toBe("merging");
    expect(merging.timings.read).toBe(55500);

    const done = run(cardAndSefach);
    expect(done.stage).toBe("done");
    expect(done.result).toEqual(result);
    expect(done.timings.merge).toBe(1000);
  });
  it("marks triage-skipped frames skipped", () => {
    const s = run([cardAndSefach[0], cardAndSefach[1], { type: "triage", seq: 3, t: 5, read: [{ i: 1, dpi: null }], skipped: [0] }]);
    expect(s.regions.map((x) => x.status)).toEqual(["skipped", "found", "skipped"]);
    expect(s.toRead).toEqual([1]);
  });
  it("marks an unreadable frame failed, from the read type or from the note", () => {
    const byType = run([...cardAndSefach.slice(0, 6), { type: "read", seq: 7, t: 9, i: 0, document_type: "unreadable", fields: {} }]);
    expect(byType.regions[0].status).toBe("failed");
    const byNote = run([...cardAndSefach.slice(0, 6), { type: "note", seq: 7, t: 9, text: "Region 1 (document) could not be read: boom" }]);
    expect(byNote.regions[0].status).toBe("failed");
  });
  it("counts a note-derived failure toward readCount, so read k/n does not freeze", () => {
    // Both frames on the page: one fails outright (note, no "read" ever arrives for it),
    // the other reads normally — readCount must still reach toRead.length and the bar
    // must advance to "merging" without waiting for `done`.
    const s = run([
      ...cardAndSefach.slice(0, 6), // through "reading, i=0"
      { type: "note", seq: 7, t: 9, text: "Region 1 (document) could not be read: boom" },
    ]);
    expect(s.regions[0]).toMatchObject({ status: "failed" });
    expect(s.readCount).toBe(1);
    expect(s.stage).toBe("reading"); // region 1 (i=1) has not been read yet
    const done = applyEvent(s, { type: "reading", seq: 8, t: 10, i: 1 });
    const merged = applyEvent(done, { type: "read", seq: 9, t: 11, i: 1, document_type: "teudat_zehut_sefach", fields: {} });
    expect(merged.readCount).toBe(2);
    expect(merged.stage).toBe("merging");
  });
  it("never counts the same region's failure twice", () => {
    const once = run([
      ...cardAndSefach.slice(0, 6),
      { type: "note", seq: 7, t: 9, text: "Region 1 (document) could not be read: boom" },
    ]);
    const twice = applyEvent(once, { type: "note", seq: 8, t: 10, text: "Region 1 (document) could not be read: boom" });
    expect(twice.readCount).toBe(once.readCount);
  });
  it("settles candidates at triage to what was actually classified, not the box count", () => {
    // Five boxes look like plausible candidates from "regions" alone (the provisional
    // estimate), but the engine classifies at most four (pipeline.py's [:4] cap): the
    // fifth is folded into triage's "skipped" list alongside genuine triage-skips, so
    // read.length + skipped.length still totals five. The classify counter must not
    // stay stuck at "4/5" — it must read "4/4" once triage is known.
    const regions = [0, 1, 2, 3, 4].map((i) => ({ i, bbox_2d: [0, 0, 10, 10], label: "document", skipped: false }));
    let s = run([
      { type: "page", seq: 1, t: 0, width: 10, height: 10 },
      { type: "regions", seq: 2, t: 1, regions },
    ]);
    expect(s.candidates).toBe(5); // provisional, before triage is known
    for (let i = 0; i < 4; i++) s = applyEvent(s, { type: "classified", seq: 3 + i, t: 2 + i, i, kind: "teudat_zehut", sure: true });
    expect(s.classified).toBe(4);
    const triaged = applyEvent(s, {
      type: "triage", seq: 10, t: 10,
      read: [{ i: 0, dpi: null }, { i: 1, dpi: null }, { i: 2, dpi: null }, { i: 3, dpi: null }],
      skipped: [4],
    });
    expect(triaged.candidates).toBe(4); // classified count, so classify reads 4/4
  });
  it("falls back to read + skipped when the classifier is off (no classified events at all)", () => {
    const regions = [0, 1].map((i) => ({ i, bbox_2d: [0, 0, 10, 10], label: "document", skipped: false }));
    const s = run([
      { type: "page", seq: 1, t: 0, width: 10, height: 10 },
      { type: "regions", seq: 2, t: 1, regions },
    ]);
    expect(s.classified).toBe(0);
    const triaged = applyEvent(s, { type: "triage", seq: 3, t: 2, read: [{ i: 0, dpi: null }, { i: 1, dpi: null }], skipped: [] });
    expect(triaged.candidates).toBe(2); // no "classified" events ever arrive with MAKOR_CLASSIFY=off
  });
  it("reads the whole page when there are no regions", () => {
    const s = run([
      { type: "page", seq: 1, t: 0, width: 10, height: 10 },
      { type: "regions", seq: 2, t: 1, regions: [] },
      { type: "classified", seq: 3, t: 2, i: null, kind: "teudat_zehut", sure: true },
      { type: "triage", seq: 4, t: 3, read: [{ i: null, dpi: null }], skipped: [] },
      { type: "reading", seq: 5, t: 4, i: null },
    ]);
    expect(s.candidates).toBe(1);
    expect(s.whole).toEqual({ status: "reading" });
    const r = applyEvent(s, { type: "read", seq: 6, t: 5, i: null, document_type: "teudat_zehut", fields: { id_number: { value: "123456782", confidence: "high" } } });
    expect(r.whole?.status).toBe("read");
    expect(r.stage).toBe("merging");
  });
  it("keeps what arrived on error", () => {
    const s = run([...cardAndSefach.slice(0, 7), { type: "error", error: "ENGINE_ERROR", detail: "boom" }]);
    expect(s.stage).toBe("error");
    expect(s.error).toEqual({ code: "ENGINE_ERROR", detail: "boom", at: "reading" });
    expect(s.regions[0].status).toBe("read");
  });
  it("an error ends every scan still running, so the preview stops sweeping", () => {
    // A read that failed upstream sends no "read": the frame stayed "reading" and its beam ran forever.
    const s = run([...cardAndSefach.slice(0, 8), { type: "error", error: "ENGINE_ERROR", detail: "boom" }]);
    expect(s.regions.map((r) => r.status)).toEqual(["read", "failed", "skipped"]);
    const whole = run([...cardAndSefach.slice(0, 1), { type: "reading", seq: 2, t: 3, i: null }, { type: "error", error: "ENGINE_ERROR", detail: "boom" }]);
    expect(whole.whole?.status).toBe("failed");
  });
  it("records which stage was running when the error arrived", () => {
    const s = run([...cardAndSefach.slice(0, 7), { type: "error", error: "ENGINE_ERROR", detail: "boom" }]);
    expect(s.error?.at).toBe("reading");
  });
  it("resets to a fresh idle state", () => {
    const s: ExtractState = applyEvent(run(cardAndSefach), { type: "reset", now: 5, stage: "idle" });
    expect(s).toEqual(initialState(5, "idle"));
  });
  it("no-ops on an event type it does not model, instead of dying on state.regions of undefined", () => {
    const before = run(cardAndSefach.slice(0, 7));
    const after = applyEvent(before, { type: "some_future_event", i: 0 } as unknown as StreamEvent);
    expect(after).toEqual(before);
  });
});
