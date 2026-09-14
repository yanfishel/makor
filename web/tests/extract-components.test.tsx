import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EngineLine } from "@/components/extract/EngineLine";
import { PageHeader } from "@/components/PageHeader";
import { RegionBox } from "@/components/extract/RegionBox";
import { RunSummary } from "@/components/extract/RunSummary";
import { StageTable } from "@/components/extract/StageTable";
import { initialState, type RegionState } from "@/lib/extract-stream";

const wrap = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <TooltipProvider>{el}</TooltipProvider>
    </NextIntlClientProvider>,
  );
const rect = { left: 10, top: 20, width: 100, height: 50 };
const region = (over: Partial<RegionState>): RegionState => ({ i: 0, bbox: [0, 0, 100, 100], label: "document", status: "found", ...over });
const box = (over: Partial<RegionState>, extra: Partial<Parameters<typeof RegionBox>[0]> = {}) =>
  wrap(createElement(RegionBox, { region: region(over), rect, done: false, hovered: false, reduced: true, onHover: () => {}, onClick: () => {}, ...extra }));

describe("RegionBox", () => {
  it("numbers a found region and places it in screen pixels", () => {
    const html = box({});
    expect(html).toContain('data-region="0"');
    expect(html).toContain('data-status="found"');
    expect(html).toContain("region 1");
    expect(html).toContain("left:10px");
    expect(html).toContain("width:100px");
  });
  it("captions a classified region with its family and dpi", () => {
    const html = box({ status: "classified", kind: "teudat_zehut", dpi: 300 });
    expect(html).toContain("Teudat Zehut");
    expect(html).toContain("300 dpi");
  });
  it("isolates each part of the caption", () => {
    // Joined into one string, a Hebrew label and a Latin unit are reordered by the bidi
    // algorithm ("תעודת זהות · 100 dpi" renders as "100 · תעודת זהות dpi"): the space between
    // the number and "dpi" takes the paragraph's direction and splits them.
    const html = box({ status: "classified", kind: "teudat_zehut", dpi: 300 });
    expect(html).toContain("<bdi>Teudat Zehut</bdi>");
    expect(html).toContain("<bdi>300 dpi</bdi>");
  });
  it("shows the field count once read, and the beam only while reading without reduced motion", () => {
    expect(box({ status: "read", docType: "teudat_zehut", fields: [{ name: "a", value: "1", confidence: "high" }, { name: "b", value: "2", confidence: "high" }] })).toContain("2 fields");
    expect(box({ status: "reading" }, { reduced: true })).not.toContain('data-slot="scan"');
    expect(box({ status: "reading" }, { reduced: false })).toContain('data-slot="scan"');
  });
  it("labels skipped and unreadable regions", () => {
    expect(box({ status: "skipped" })).toContain("skipped");
    expect(box({ status: "failed" })).toContain("unreadable");
  });
  it("names the sefach frame TZ Sefach — before the read, after it, and after the page is published", () => {
    // Only on this page: the card and its sheet are two boxes, and "Teudat Zehut" on both says
    // nothing. Everywhere else the sheet is folded into the card's family.
    expect(box({ status: "classified", kind: "sefach", dpi: 300 })).toContain("TZ Sefach");
    expect(box({ status: "read", docType: "teudat_zehut_sefach" })).toContain("TZ Sefach");
    const done = box({ status: "read", docType: "teudat_zehut_sefach" }, { done: true, pageType: "teudat_zehut" });
    expect(done).toContain("TZ Sefach");
    expect(done).not.toContain("Teudat Zehut");
  });
  it("captions a read region with the page's published type once the run is done, keeping what it was read as", () => {
    const read = { status: "read" as const, docType: "disability_card", dpi: 300 };
    expect(box(read)).toContain("Disability card");                                   // while the page is still running
    const done = box(read, { done: true, pageType: "teudat_zehut_sefach" });
    expect(done).toContain("Teudat Zehut");
    expect(done).not.toContain("Disability card");
    expect(done).toContain('data-read-as="disability_card"');
  });
  it("never lends the page's type to a frame that was left out of it", () => {
    for (const status of ["skipped", "failed"] as const) {
      expect(box({ status, docType: "other" }, { done: true, pageType: "teudat_zehut" })).not.toContain("Teudat Zehut");
    }
  });
});

const RESULT = {
  document_type: "teudat_zehut",
  fields: { id_number: { value: "123456782", confidence: "high" as const } },
  validation: { overall: "unverified" },
  warnings: [], regions: [], sefach: null, model: "ollama/qwen3-vl:8b-instruct",
  meta: { mode: "local", trial_remaining: null, backend: "ollama", model: "qwen3-vl:8b-instruct", document_id: "d1" },
};

describe("StageTable", () => {
  it("marks the active stage and shows counts and timings", () => {
    const s = { ...initialState(0), stage: "reading" as const, candidates: 2, classified: 2, toRead: [0, 1], readCount: 1, timings: { detect: 118, classify: 4280 } };
    const html = wrap(createElement(StageTable, { state: s }));
    expect(html).toContain('data-stage="reading"');
    expect(html).toContain("0.1s");
    expect(html).toContain("4.3s");
    expect(html).toContain("2/2");
    expect(html).toContain("1/2");
    expect(html).toMatch(/data-item="read"[^>]*data-state="active"/);
    expect(html).toMatch(/data-item="mergeValidate"[^>]*data-state="pending"/);
    expect(html).toMatch(/data-item="detect"[^>]*data-state="done"/);
  });
  it("is all done at done", () => {
    const html = wrap(createElement(StageTable, { state: { ...initialState(0), stage: "done" as const } }));
    expect(html).not.toContain('data-state="active"');
    expect(html).not.toContain('data-state="pending"');
  });
  it("gives every stage its own row, with its timing in its own cell", () => {
    const s = { ...initialState(0), stage: "reading" as const, timings: { detect: 118 } };
    const html = wrap(createElement(StageTable, { state: s }));
    // Four rows, not five: merge and validate share one — the engine times them together.
    expect((html.match(/<tr /g) ?? []).length).toBe(4);
    expect(html).toContain("Merge &amp; validate");
    expect(html).toMatch(/<td[^>]*><span dir="ltr">0\.1s<\/span><\/td>/);   // isolated: "s 0.1" in Hebrew otherwise
  });
  it("marks the stage that failed, not everything, when the run errors mid-read", () => {
    const s = { ...initialState(0), stage: "error" as const, error: { code: "ENGINE_ERROR", detail: "boom", at: "reading" as const } };
    const html = wrap(createElement(StageTable, { state: s }));
    expect(html).toMatch(/data-item="detect"[^>]*data-state="done"/);
    expect(html).toMatch(/data-item="classify"[^>]*data-state="done"/);
    expect(html).toMatch(/data-item="read"[^>]*data-state="failed"/);
    expect(html).toMatch(/data-item="mergeValidate"[^>]*data-state="pending"/);
  });
});

import { DocumentScene } from "@/components/extract/DocumentScene";
import { FieldLedger } from "@/components/extract/FieldLedger";
import { applyEvent } from "@/lib/extract-stream";

describe("DocumentScene", () => {
  it("is an LTR island with the bed, the toolbar and the image", () => {
    const s = applyEvent(initialState(0), { type: "page", seq: 1, t: 0, width: 800, height: 600 });
    const html = wrap(createElement(DocumentScene, { src: "blob:x", state: s, hoverIndex: null, onHover: () => {} }));
    expect(html).toMatch(/data-slot="scene"[^>]*dir="ltr"/);
    expect(html).toContain('lang="en"');
    expect(html).toContain('src="blob:x"');
    for (const n of ["Fit", "100%", "Zoom in", "Zoom out"]) expect(html).toContain(n);
  });
  it("names the file and both sizes on the toolbar, above the bed", () => {
    const s = applyEvent(initialState(0), { type: "page", seq: 1, t: 0, width: 2480, height: 3508 });
    const html = wrap(createElement(DocumentScene, { src: "blob:x", file: { name: "document.jpg", size: 1_500_000 }, state: s, hoverIndex: null, onHover: () => {} }));
    expect(html).toContain("document.jpg");
    expect(html).toContain("1.4 MB");
    expect(html).toContain("2480 × 3508");
    expect(html.indexOf('data-slot="scene-toolbar"')).toBeLessThan(html.indexOf('src="blob:x"'));
  });
  it("orders the zoom controls fit | 100% | - | scale | +", () => {
    const s = applyEvent(initialState(0), { type: "page", seq: 1, t: 0, width: 800, height: 600 });
    const html = wrap(createElement(DocumentScene, { src: "blob:x", state: s, hoverIndex: null, onHover: () => {} }));
    const at = (needle: string) => { const i = html.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    const order = [">Fit<", ">100%<", 'aria-label="Zoom out"', ">100%</span>", 'aria-label="Zoom in"'].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("draws one box per region", () => {
    const s = applyEvent(applyEvent(initialState(0), { type: "page", seq: 1, t: 0, width: 800, height: 600 }),
      { type: "regions", seq: 2, t: 1, regions: [{ i: 0, bbox_2d: [0, 0, 500, 500], label: "document", skipped: false }, { i: 1, bbox_2d: [500, 500, 1000, 1000], label: "sefach", skipped: false }] });
    const html = wrap(createElement(DocumentScene, { src: "blob:x", state: s, hoverIndex: null, onHover: () => {} }));
    expect((html.match(/data-region="/g) ?? []).length).toBe(2);
  });
  it("shows the waiting note while a PDF has no preview yet", () => {
    const html = wrap(createElement(DocumentScene, { src: null, state: initialState(0), hoverIndex: null, onHover: () => {} }));
    expect(html).toContain("Waiting for the page");
  });
});

describe("FieldLedger", () => {
  it("groups fields by region in reading order with ghosts for the frame being read", () => {
    let s = initialState(0);
    for (const e of [
      { type: "page", seq: 1, t: 0, width: 8, height: 6 },
      { type: "regions", seq: 2, t: 1, regions: [{ i: 0, bbox_2d: [0, 0, 5, 5], label: "document", skipped: false }, { i: 1, bbox_2d: [5, 5, 9, 9], label: "sefach", skipped: false }] },
      { type: "triage", seq: 3, t: 2, read: [{ i: 0, dpi: null }, { i: 1, dpi: null }], skipped: [] },
      { type: "reading", seq: 4, t: 3, i: 0 },
      { type: "read", seq: 5, t: 4, i: 0, document_type: "teudat_zehut", fields: { id_number: { value: "123456782", confidence: "high" } } },
      { type: "reading", seq: 6, t: 5, i: 1 },
      { type: "note", seq: 7, t: 6, text: "The image is about 100 dpi — below the recommended 150 dpi" },
    ] as const) s = applyEvent(s, e as Parameters<typeof applyEvent>[1]);
    const html = wrap(createElement(FieldLedger, { state: s, hoverIndex: null, onHover: () => {} }));
    expect(html.indexOf('data-region-group="0"')).toBeLessThan(html.indexOf('data-region-group="1"'));
    expect(html).toContain("id_number");
    expect(html).toContain("123456782");
    expect(html).toContain('data-slot="skeleton"');
    expect(html).toContain("about 100 dpi");
  });
  it("says where fields will appear before any read", () => {
    expect(wrap(createElement(FieldLedger, { state: initialState(0), hoverIndex: null, onHover: () => {} }))).toContain("Fields appear here");
  });
  it("tells the card's group from the sheet's — one chip says Teudat Zehut, the other TZ Sefach", () => {
    let s = initialState(0);
    for (const e of [
      { type: "page", seq: 1, t: 0, width: 8, height: 6 },
      { type: "regions", seq: 2, t: 1, regions: [{ i: 0, bbox_2d: [0, 0, 5, 5], label: "document", skipped: false }, { i: 1, bbox_2d: [5, 5, 9, 9], label: "sefach", skipped: false }] },
      { type: "classified", seq: 3, t: 2, i: 0, kind: "teudat_zehut", sure: true },
      { type: "classified", seq: 4, t: 2, i: 1, kind: "sefach", sure: true },
      { type: "triage", seq: 5, t: 3, read: [{ i: 0, dpi: null }, { i: 1, dpi: null }], skipped: [] },
    ] as const) s = applyEvent(s, e as Parameters<typeof applyEvent>[1]);
    const html = wrap(createElement(FieldLedger, { state: s, hoverIndex: null, onHover: () => {} }));
    expect(html).toContain("Teudat Zehut");
    expect(html).toContain("TZ Sefach");
    expect(html.indexOf("Teudat Zehut")).toBeLessThan(html.indexOf("TZ Sefach"));
  });
  it("shows the groups, not the placeholder, right after triage and before any reading event", () => {
    let s = initialState(0);
    for (const e of [
      { type: "page", seq: 1, t: 0, width: 8, height: 6 },
      { type: "regions", seq: 2, t: 1, regions: [{ i: 0, bbox_2d: [0, 0, 5, 5], label: "document", skipped: false }, { i: 1, bbox_2d: [5, 5, 9, 9], label: "sefach", skipped: false }] },
      { type: "triage", seq: 3, t: 2, read: [{ i: 0, dpi: null }, { i: 1, dpi: null }], skipped: [] },
    ] as const) s = applyEvent(s, e as Parameters<typeof applyEvent>[1]);
    const html = wrap(createElement(FieldLedger, { state: s, hoverIndex: null, onHover: () => {} }));
    expect(html).toContain('data-region-group="0"');
    expect(html).toContain('data-region-group="1"');
    expect(html).not.toContain("Fields appear here");
  });
});

import { ExtractWorkbench } from "@/components/extract/ExtractWorkbench";

describe("RunSummary", () => {
  it("clocks the run beside the stages, and says nothing about the document", () => {
    const s = { ...initialState(0), stage: "done" as const, timings: { detect: 118 }, result: RESULT };
    const html = wrap(createElement(RunSummary, { state: s }));
    expect(html).toContain('data-slot="clock"');
    expect(html).toContain("0.1s");            // the stage table's own timing
    // The document's type, verdict and download belong to the result, below this summary.
    expect(html).not.toContain("Teudat Zehut");
    expect(html).not.toContain("Unverified");
    expect(html).not.toContain("Download JSON");
  });
});

describe("EngineLine", () => {
  it("holds the line with a skeleton until the engine answers, so the page does not jump", () => {
    // Nothing chosen: only the engine knows which backend runs and what a local tag is
    // called, so the line cannot be written on the first paint — and appearing later pushed
    // everything under the heading down.
    const html = wrap(createElement(EngineLine, { choice: { backend: null, model: null } }));
    expect(html).toContain('data-slot="engine-line-skeleton"');
  });
  it("sits in the header's description without a block element inside a paragraph", () => {
    // The skeleton is a div (shadcn's Skeleton). Rendered inside a <p> that is invalid HTML,
    // the browser closes the paragraph before it and React reports a hydration mismatch.
    const html = wrap(createElement(PageHeader, { title: "Extract a document",
      description: createElement(EngineLine, { choice: { backend: null, model: null } }) }));
    expect(html).toContain('data-slot="engine-line-skeleton"');
    expect(html).not.toMatch(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?<div/);
  });
  it("names the cloud default on the first paint: the app ships it, no request needed", () => {
    const html = wrap(createElement(EngineLine, { choice: { backend: "anthropic", model: null } }));
    expect(html).not.toContain('data-slot="engine-line-skeleton"');
    expect(html).toContain("Claude Opus 5");
  });
  it("writes itself at once when the choice needs no catalogue", () => {
    const html = wrap(createElement(EngineLine, { choice: { backend: "anthropic", model: "claude-opus-5" } }));
    expect(html).not.toContain('data-slot="engine-line-skeleton"');
    expect(html).toContain("Claude Opus 5");   // MODEL_CHOICES knows the cloud names without asking
  });
});

describe("ExtractWorkbench", () => {
  it("opens on the dropzone with the file input", () => {
    const html = wrap(createElement(ExtractWorkbench, { choice: { backend: "ollama", model: "qwen3-vl:8b-instruct" } }));
    expect(html).toContain('type="file"');
    expect(html).toContain("Drop a photo or scan here");
    expect(html).not.toContain('data-slot="scene"');
  });
  it("names the engine under the heading, before anything is uploaded", () => {
    // The raw tag until the catalogue answers — a name the web app cannot print is still true.
    const html = wrap(createElement(ExtractWorkbench, { choice: { backend: "ollama", model: "qwen3-vl:8b-instruct" } }));
    expect(html).toContain("Engine");
    expect(html).toContain("<bdi>Ollama</bdi>");
    expect(html).toContain("qwen3-vl:8b-instruct");
  });
});
