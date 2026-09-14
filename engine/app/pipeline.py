"""The pipeline, in order.

    1.  imaging.prepare_page             pixels the detector can trust
    2.  regions.detect_regions_local     where the documents are
    2a. triage.geometry_kinds            boxes no document can be, before any cut or call
    3.  cropping.cut                     one Frame per document: crop, deskew, orient, prepare
    3a. reading.classify + triage        which frames are read, and with which schema
    3b. resolution + cropping.normalize  the frame's dpi, resampled to TARGET_DPI
    4.  reading.read_frame               a model turns a Frame into typed fields
    5.  assemble.merge / merge_cheque    several documents become one page result

rescue_sefach lives here rather than in assemble.py because it is the one deterministic
guard that makes a model call: the card on the same page is ground truth, and a holder
block that disagrees with it gets re-read.
"""

import asyncio
from dataclasses import dataclass, field, replace
from typing import NamedTuple, cast

from PIL import Image

from . import config
from .assemble import (
    accept_reread_ids,
    apply_holder_block,
    holder_reread_verdict,
    match_sefach_by_name,
    merge,
    merge_cheque,
    reconcile_sefach_names,
    sefach_needs_rescue,
    sefach_payload,
    select_sefach,
)
from .cropping import (
    CROP_MIN_DIM,
    SEFACH_RESCUE_MARGINS,
    SEFACH_STRIP_MIN_ASPECT,
    Frame,
    bbox_pixels,
    cut,
    encode_floor,
    normalize,
    sefach_cells,
    whole,
)
from .doctypes import IDENTITY_TYPES, KIND_TO_LABEL, PRIORITY, UNSUPPORTED_KINDS
from .errors import ConfigurationError, ExtractionError
from .imaging import Page, encode_jpeg, prepare_page
from .reading import (
    CallUsage,
    Progress,
    RegionOutcome,
    RunOptions,
    _options,
    _progress,
    _usage_collector,
    backend_ollama,
    classify_frame,
    current_options,
    emit_progress,
    read_frame,
    usage_log,
)
from .reading.backend_anthropic import _request_client, reread_id_anthropic
from .reading.backend_ollama import (
    DETECT_MAX_DIM,
    DETECT_MAX_TOKENS,
    SEFACH_BLOCK_MAX_TOKENS,
    _cell_b64,
    sefach_to_document,
)
from .reading.prompts import DETECT_PROMPT, SEFACH_BLOCK_SYSTEM_PROMPT, SEFACH_HOLDER_PROMPT
from .regions import detect_regions_local
from .resolution import document_long_edge_px, estimate_dpi, low_resolution_warning
from .schemas import (
    CHEQUE_FIELDS_EXCLUDE,
    IDENTITY_FIELDS_EXCLUDE,
    ChequeExtraction,
    DocumentExtraction,
    ExtractedField,
    RegionDetection,
    RegionResult,
    SefachExtraction,
    SefachHolderBlock,
)
from .triage import Selection, cheque_back_inherits, geometry_kinds, page_is_junk, select_frames


class Cut(NamedTuple):
    """One cut frame with the geometry it came from. The three travel together through
    stage 3a and stage 4: the classifier needs the image, `triage.select_frames` the top
    edge, `regions[]` the label and the box — all addressed by the same index."""

    frame: Frame
    bbox: list[int]
    label: str | None


@dataclass
class PipelineResult:
    extraction: DocumentExtraction | None  # None when the page holds only a cheque — or nothing readable
    regions: list[RegionResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    sefach: SefachExtraction | None = None
    cheque: ChequeExtraction | None = None
    usage: list[CallUsage] = field(default_factory=list)
    # Phase 1 of the unsupported types (senior citizen / disability / weapon licence):
    # the reader answers "other" for them (its vocabulary has no such type), and the
    # classifier's kind is the only knowledge of what the page holds. main.py publishes
    # it as document_type with a "not tuned" warning. None everywhere else.
    classified_type: str | None = None


async def rescue_sefach(
    sheet: Image.Image, sefach: SefachExtraction, card: DocumentExtraction, floor: int = CROP_MIN_DIM,
) -> tuple[SefachExtraction, str | None]:
    """Re-read the holder block with SEFACH_RESCUE_MARGINS until the card accepts one.

    Returns the sefach and how it was accepted ("id" / "names"), or the sefach unchanged and
    None when no margin was accepted — select_sefach then decides whose sheet it is. A
    successful rescue is NOT a warning: the client sees the sheet's readings and the `medium`
    on the number it took from the card, which is what the warning used to say. It goes to the
    usage log instead (provenance, no values)."""
    if sheet.width / sheet.height >= SEFACH_STRIP_MIN_ASPECT:
        return sefach, []  # the two-column strip has no grid holder cell to re-read
    for margin in SEFACH_RESCUE_MARGINS:
        cell = next(c for r, col, c in sefach_cells(sheet, margin) if (r, col) == (0, 0))
        holder = await backend_ollama._ollama_json(_cell_b64(cell, floor), SEFACH_BLOCK_SYSTEM_PROMPT, SEFACH_HOLDER_PROMPT,
                                    SefachHolderBlock, SEFACH_BLOCK_MAX_TOKENS)
        verdict = holder_reread_verdict(holder, card)
        if verdict is not None:
            usage_log.info("sefach holder re-read accepted=%s margin=%.2f", verdict, margin)
            return apply_holder_block(sefach, holder, card, verdict), verdict
    return sefach, None


async def run(raw: bytes, options: RunOptions | None = None, progress: Progress | None = None) -> PipelineResult:
    """The pipeline plus usage collection: every model call made while it runs lands in
    PipelineResult.usage (one CallUsage per call). `options` selects backend/model/key
    for this request only; `progress`, when given, receives the NDJSON stream's stage events
    (page, regions, classified, triage, reading, read, note) as they happen."""
    collected: list[CallUsage] = []
    token = _usage_collector.set(collected)
    opts_token = _options.set(options or RunOptions.from_config())
    client_token = _request_client.set(None)
    progress_token = _progress.set(progress)
    if progress is not None:
        progress.start()
    try:
        result = await _run(raw)
    finally:
        client = _request_client.get()
        if client is not None:
            await client.close()
        _request_client.reset(client_token)
        _options.reset(opts_token)
        _usage_collector.reset(token)
        _progress.reset(progress_token)
    result.usage = collected
    return result


def _log_frame(backend: str, frame: Frame) -> None:
    """Preparation metadata for one Frame, so a bad read can be traced to what
    preparation did to it without re-running anything. Counts and provenance only —
    never a field value, a transcript line, or anything derived from document content."""
    w, h = frame.image.size
    usage_log.info("backend=%s region=%s size=%dx%d aspect=%.2f rotation=%d deskew=%.1f filters=%s dpi=%s resample=%.2f",
                    backend, frame.label or "document", w, h, max(w, h) / max(1, min(w, h)),
                    frame.rotation, frame.deskewed, ",".join(frame.filters) or "none",
                    frame.dpi if frame.dpi is not None else "none", frame.resampled)


def _emit_page(raw: bytes, page: Page) -> None:
    """The page's size for the client's canvas; for a PDF also its pixels. A scanned PDF's
    Page is the embedded scan turned by its placement matrix, not the PDF page with its
    margins, so a browser render of the PDF would put every box off (and possibly a
    quarter turn out). Encoded only when someone is listening."""
    if _progress.get() is None:
        return
    preview = {"preview": "data:image/jpeg;base64," + encode_jpeg(page.image, config.MAX_IMAGE_DIMENSION)} if raw[:4] == b"%PDF" else {}
    emit_progress("page", width=page.image.width, height=page.image.height, **preview)


def _outcome_event(outcome: RegionOutcome) -> dict:
    """What one read frame contributes, in the API's field shape: postprocessed, not yet
    merged — the final result may still change it (sefach rescue, name reconciliation)."""
    if outcome.cheque is not None:
        fields = outcome.cheque.model_dump(exclude=CHEQUE_FIELDS_EXCLUDE)
    elif outcome.extraction is not None:
        fields = outcome.extraction.model_dump(exclude=IDENTITY_FIELDS_EXCLUDE)
    else:
        fields = {}
    event: dict = {"document_type": outcome.document_type, "fields": fields}
    if outcome.sefach is not None:
        event["sefach"] = sefach_payload(outcome.sefach)
    return event


async def _classify_all(backend: str, indices: list[int], frames: list[Cut], pending: list[str | None], sure: list[bool],
                        region_of: list[int | None]) -> None:
    """Classify the frames at `indices`, filling `pending`/`sure` by index. Ollama serves one
    vision request at a time, so its calls stay sequential; the Anthropic API takes them in
    parallel, and a page with several candidates paid one classifier latency per frame in
    sequence before any read started. The calls are independent (a thumbnail each), so
    the answers cannot differ; a TaskGroup cancels the siblings of a failed call so the
    request fails as it always did, with no orphaned call left running."""
    async def one(i: int) -> None:
        answer = await classify_frame(frames[i].frame)
        pending[i], sure[i] = answer.kind, answer.sure
        emit_progress("classified", i=region_of[i], kind=answer.kind, sure=answer.sure)

    if backend == "anthropic":
        async with asyncio.TaskGroup() as group:
            for i in indices:
                group.create_task(one(i))
    else:
        for i in indices:
            await one(i)


async def _run(raw: bytes) -> PipelineResult:
    page = prepare_page(raw)
    _emit_page(raw, page)
    backend = current_options().backend

    if backend not in ("ollama", "anthropic"):
        raise ConfigurationError(f"Unknown backend: {backend!r} (use 'ollama' or 'anthropic')")

    # 2. regions.detect: classical CV first (no model call, no run-to-run jitter — see
    # app/regions.py), the model's detector only when it finds nothing. Sees raw Page
    # pixels: regions.py thresholds saturation/ink against numbers measured unfiltered.
    regions: list = detect_regions_local(page.image)
    if regions:
        usage_log.info("backend=%s detector=local regions=%d", backend, len(regions))
    elif backend == "ollama":
        try:
            # No COMPACT_JSON here: with it the detector returned one box instead of two
            # (card + sefach) on every A4-scan run. Its output is short anyway.
            detected = await backend_ollama._ollama_json(
                encode_jpeg(page.image, DETECT_MAX_DIM), None, DETECT_PROMPT, RegionDetection, DETECT_MAX_TOKENS
            )
            regions = [r for r in detected.regions if len(r.bbox_2d) == 4 and r.bbox_2d[2] > r.bbox_2d[0] and r.bbox_2d[3] > r.bbox_2d[1]]
        except ExtractionError:
            regions = []  # detection is best-effort; fall back to the whole image

    # A single box covering (almost) everything means the image already is the document:
    # use the whole image, but keep the detector's label for the schema choice.
    def _area(b): return (b[2] - b[0]) * (b[3] - b[1]) / 1_000_000
    single_label: str | None = None
    if len(regions) == 1 and _area(regions[0].bbox_2d) > 0.8:
        single_label = regions[0].label
        regions = []

    # 3a-pre. Geometry before any model call (triage.geometry_kinds / page_is_junk, on the
    # detector's boxes alone): a page with junk boxes is rejected here, zero calls; a
    # single sliver inside a real document is skipped without a call and the document
    # goes on. The whole-page frame gets the same size/aspect test. Provenance only: the
    # usage log carries counts.
    page_size = page.image.size
    page_boxes = [r.bbox_2d for r in regions] if regions else [[0, 0, 1000, 1000]]
    geo: list[str | None] = geometry_kinds(page_boxes, page_size) if config.CLASSIFY else [None] * len(page_boxes)
    emit_progress("regions", regions=[{"i": j, "bbox_2d": r.bbox_2d, "label": r.label or "document", "skipped": geo[j] == "none"}
                                      for j, r in enumerate(regions)])
    if config.CLASSIFY and page_is_junk(page_boxes, page_size):
        junk = sum(1 for k in geo if k == "none")
        usage_log.info("backend=%s geometry=rejected boxes=%d junk=%d", backend, len(page_boxes), junk)
        return PipelineResult(
            extraction=None,
            regions=[RegionResult(label=r.label or "document", bbox_2d=r.bbox_2d, document_type="skipped") for r in regions]
            or [RegionResult(label=single_label or "document", bbox_2d=[0, 0, 1000, 1000], document_type="skipped")],
            warnings=[*page.warnings, f"Page rejected on geometry: {junk} of {len(page_boxes)} detected box(es) cannot be a document"],
        )
    # Candidates are the geometrically possible boxes; the cap on how many are cut and
    # classified applies to them, so junk never displaces a real document from the cap.
    candidates = [i for i, k in enumerate(geo) if k is None][:4] if regions else []
    junk_regions = [i for i, k in enumerate(geo) if k == "none"] if regions else []

    # 3. cropping.cut each region into a Frame, then 4. reading.read_frame turns it into
    # typed fields (or the whole image, when detection found nothing to crop). cut applies
    # no upscale: the sefach grid/old-sheet readers split a Frame's own image into
    # sub-cells (app/reading/backend_ollama.py), each upscaled to CROP_MIN_DIM on its own
    # at encode time; upscaling the whole sheet here first would resample it twice at a
    # different ratio and hand the cell splitter different pixels than today. Every other
    # Ollama call already applies the same min_dim=CROP_MIN_DIM at its own encode step
    # (unchanged), so a Frame carrying no upscale changes nothing for those calls either.
    results: list[DocumentExtraction] = []
    # Each sefach with its sheet crop (rescue_sefach re-reads from it) and the index of
    # the DocumentExtraction derived from it in `results` (a rescued sefach replaces it).
    sefachs: list[tuple[SefachExtraction, Image.Image, int | None, int]] = []  # ... and the sheet's encode floor
    cheques: list[ChequeExtraction] = []
    frame_images: dict[int, Image.Image] = {}  # index in `results` -> the Frame it was read from
    frame_floors: dict[int, int] = {}  # index in `results` -> that Frame's encode floor (cropping.encode_floor)
    frame_of_result: dict[int, int] = {}  # index in `results` -> index in `frames`
    region_warnings: list[str] = []

    def _note(text: str) -> None:
        region_warnings.append(text)
        emit_progress("note", text=text)

    def _page_frame(label: str | None) -> Frame:
        # The Ollama path straightens and orients the page like any crop; the Anthropic
        # path takes it as it is (filters only): page-level deskew/orientation was
        # measured against the samples and reverted — two files lost 8-12% of linear
        # resolution to a deskew-then-cap round trip, a third was rotated 180 degrees by
        # the page-level check while the per-region path answered "don't know" for the
        # same document. Orientation is a per-crop decision; a page can hold one
        # document upright and another inverted. Reviving it needs a live measurement.
        return cut(page, None, label) if backend == "ollama" else whole(page, label)

    def _collect(outcome: RegionOutcome, sheet: Image.Image, frame_index: int, floor: int) -> None:
        if outcome.cheque is not None:
            cheques.append(outcome.cheque)
        if outcome.extraction is not None:
            results.append(outcome.extraction)
            frame_images[len(results) - 1] = sheet
            frame_of_result[len(results) - 1] = frame_index
            frame_floors[len(results) - 1] = floor
        if outcome.sefach is not None:
            derived = len(results) - 1 if outcome.extraction is not None else None
            sefachs.append((outcome.sefach, sheet, derived, floor))

    # 3a. Every frame is cut before anything is read, then classified on a thumbnail
    # (reading/classify.py) so that triage.select_frames can decide what is read at all:
    # every identity-family frame, else the first cheque front + back, else nothing. The
    # whole-page frame (no regions, or one box that IS the page) is classified the same
    # way — a phone photo of a memo is the likeliest "not a document" of all.
    frames: list[Cut]
    frame_region: list[int]  # frame index -> index in `regions` (slots keep detector order)
    if regions:
        frames = [Cut(cut(page, regions[i].bbox_2d, regions[i].label), regions[i].bbox_2d, regions[i].label) for i in candidates]
        frame_region = list(candidates)
    else:
        frames = [Cut(_page_frame(single_label), [0, 0, 1000, 1000], single_label)]
        frame_region = [0]
    region_of: list[int | None] = [frame_region[i] if regions else None for i in range(len(frames))]
    for c in frames:
        _log_frame(backend, c.frame)
    kinds: list[str] | None = None
    sure: list[bool] = [False] * len(frames)
    if config.CLASSIFY:
        pending: list[str | None] = [None] * len(frames)
        # Three or more candidates on one page: one call on the page itself first. "none"
        # settles every candidate — a page of text or a table splits into many boxes, and
        # four calls to learn that cost 18 s on Ollama. Any other answer changes nothing:
        # the classifier's positive label decides only the reading schema, below.
        if len(frames) >= config.PAGE_FIRST_MIN_REGIONS and regions:
            page_kind = (await classify_frame(Frame(image=page.image))).kind
            usage_log.info("backend=%s page_first=%s", backend, page_kind)
            if page_kind == "none":
                pending = ["none"] * len(frames)
                for i in range(len(frames)):
                    emit_progress("classified", i=region_of[i], kind="none", sure=True)
        # Detector-labelled cheque backs go last: with a classifier-confirmed front on the
        # page they inherit "cheque_back" without a call (triage.cheque_back_inherits — the
        # 8B model calls a stamped back "none"); otherwise they are classified like any frame.
        fronts = [i for i, c in enumerate(frames) if pending[i] is None and c.label != "cheque_back"]
        await _classify_all(backend, fronts, frames, pending, sure, region_of)
        backs = [i for i, c in enumerate(frames) if pending[i] is None and c.label == "cheque_back"]
        if backs and cheque_back_inherits(pending):
            for i in backs:
                pending[i], sure[i] = "cheque_back", True
                emit_progress("classified", i=region_of[i], kind="cheque_back", sure=True)
        else:
            await _classify_all(backend, backs, frames, pending, sure, region_of)
        if any(k is None for k in pending):
            # kinds is indexed by frame, so a gap may never be filtered out: dropping one
            # would shift every later frame's kind onto its neighbour. An assert would
            # vanish under python -O and let that happen silently.
            raise RuntimeError("stage 3a left a frame unclassified")
        kinds = cast(list[str], pending)
        # Every frame's kind, including the ones triage is about to skip: the read loop's
        # own line below covers only what is read, and a change to the classifier's
        # vocabulary is measured by comparing these tables. Kinds, never values.
        usage_log.info("backend=%s kinds=%s", backend,
                       ",".join(f"{k}:{s}" for k, s in zip(kinds, sure, strict=True)))
        selection = select_frames(kinds, [c.bbox[1] for c in frames])
    else:
        selection = Selection(read=list(range(len(frames))), skipped=[])

    # 3b. Resolution, now that the kind is known (app/resolution.py): a sure kind with a
    # fixed physical size, else the page when it is a scanned sheet, gives each frame a
    # dpi; the frame is resampled to config.TARGET_DPI and a source below WARN_DPI is
    # reported. Unknown = the frame's own pixels and the CROP_MIN_DIM floor, as before.
    dpis: list[int | None] = [None] * len(frames)
    for i, c in enumerate(frames):
        is_page = not regions or c.bbox == [0, 0, 1000, 1000]
        box_w, box_h = bbox_pixels(page.image.size, c.bbox)
        doc_px = document_long_edge_px(box_w, box_h, c.frame.deskewed)
        w, h = c.frame.image.size
        kind = kinds[i] if kinds is not None else None
        dpi = estimate_dpi(kind, sure[i], doc_px, page.image.size, is_page, w >= h)
        dpis[i] = dpi
        frames[i] = Cut(normalize(c.frame, dpi), c.bbox, c.label)
        if dpi is not None and i in selection.read:
            usage_log.info("backend=%s region=%d dpi=%d resample=%.2f", backend, frame_region[i] + 1, dpi, frames[i].frame.resampled)
    # One upload, one resolution note: the crops share the file they were cut from, and the
    # page-first estimate gives them the same number anyway. The lowest is what limits the
    # reading, and `regions[].dpi` still carries each frame's own estimate.
    read_dpis = [dpis[i] for i in selection.read if dpis[i] is not None]
    if read_dpis:
        note = low_resolution_warning(min(read_dpis))
        if note:
            _note(note)

    beyond_cap = [j for j in range(len(regions)) if j not in candidates and j not in junk_regions]
    emit_progress("triage", read=[{"i": region_of[i], "dpi": dpis[i]} for i in selection.read],
                  skipped=[region_of[i] for i in selection.skipped] + beyond_cap)

    # 4. reading.read_frame turns each selected Frame into typed fields. `regions[]` keeps
    # detector order: skipped and unreadable frames keep their slot. The whole-page
    # frame gets a slot only when skipped — a read page has no region entry, as before.
    slots: list[RegionResult | None] = [None] * max(len(regions), 1)
    for j in junk_regions:  # geometry said "none": skipped without a cut or a call
        r = regions[j]
        slots[j] = RegionResult(label=r.label or "document", bbox_2d=r.bbox_2d, document_type="skipped")
    for i in selection.skipped:
        c = frames[i]
        slots[frame_region[i]] = RegionResult(label=c.label or "document", bbox_2d=c.bbox, document_type="skipped", dpi=dpis[i])
    failures: list[ExtractionError] = []
    for i in selection.read:
        c = frames[i]
        # A sure classifier kind chooses the reading schema: it replaces the detector's
        # label on the frame the reader sees (doctypes.KIND_TO_LABEL). An unsure kind
        # leaves the detector's label — and its safety nets (cheque/identity redirects,
        # the generic retry) — exactly as before. Corpus: 25/25 sure kinds correct 2/2.
        read_label = KIND_TO_LABEL.get(kinds[i]) if kinds is not None and sure[i] else c.label
        usage_log.info("backend=%s read_as=%s kind=%s sure=%s detector=%s", backend, read_label or "document",
                       kinds[i] if kinds is not None else "-", sure[i], c.label or "document")
        emit_progress("reading", i=region_of[i])
        try:
            outcome = await read_frame(replace(c.frame, label=read_label))
        except ExtractionError as exc:
            if not regions:
                raise  # the uncropped page was the only frame; nothing left to try
            # One region the model cannot read (a blank cheque back looped until the
            # token cap) must not fail a page whose other regions read fine.
            failures.append(exc)
            _note(f"Region {frame_region[i] + 1} ({c.label or 'document'}) could not be read: {exc}")
            slots[frame_region[i]] = RegionResult(label=c.label or "document", bbox_2d=c.bbox, document_type="unreadable", dpi=dpis[i])
            continue
        _collect(outcome, c.frame.image, i, encode_floor(c.frame))
        emit_progress("read", i=region_of[i], **_outcome_event(outcome))
        if outcome.blind:
            # Stage A came back with nothing (a transcript that looped to the end, or a
            # generation cut off twice), so the fields were read straight from the pixels:
            # no anchor pinned a name, an ID or a sex, and no printed label opened the
            # label gate. Every layout-dependent field is then empty because it could not
            # be read, not because the document does not print it — say which it is.
            _note(
                f"Region {frame_region[i] + 1} ({c.label or 'document'}) could not be transcribed; "
                "the fields that depend on its printed layout were not read"
            )
        if regions:
            slots[frame_region[i]] = RegionResult(
                label=c.label or "document", bbox_2d=c.bbox, document_type=outcome.document_type, dpi=dpis[i],
            )
    if regions and failures and len(failures) == len(selection.read):
        # Every selected crop failed. The page itself may still read (a narrow cheque
        # scan's front crop looped until the token cap 2/2, the uncropped page read fine):
        # one attempt on the whole image, with the region's label when there is one.
        frame = _page_frame(regions[0].label if len(regions) == 1 else None)
        _log_frame(backend, frame)
        emit_progress("reading", i=None)
        try:
            outcome = await read_frame(frame)
        except ExtractionError:
            raise failures[-1] from None
        _collect(outcome, frame.image, selection.read[0], encode_floor(frame))
        emit_progress("read", i=None, **_outcome_event(outcome))
        _note("No region could be read on its own; the whole page was read instead")
    if (selection.skipped or junk_regions) and selection.read:
        _note(f"{len(selection.skipped) + len(junk_regions)} more document(s) on the page were not read")
    region_results: list[RegionResult] = [slot for slot in slots if slot is not None]
    # "other"/"unreadable" documents are dropped at merge time, not here: `derived`
    # indexes into `results` as collected, and dropping entries first shifted the
    # index onto the card on a wallet scan whose first region is a discharge card —
    # the sefach guard then overwrote the card with the sefach-derived document.

    # 5. assemble: merge regions into one page result.
    def _mergeable() -> list[DocumentExtraction]:
        return [r for r in results if r.document_type not in ("other", "unreadable")] or results

    def _primary_index() -> int | None:
        candidates = [i for i, r in enumerate(results) if r.document_type not in ("other", "unreadable")] or list(range(len(results)))
        return min(candidates, key=lambda i: PRIORITY.index(results[i].document_type)) if candidates else None

    def _primary_image() -> Image.Image | None:
        index = _primary_index()
        return frame_images.get(index) if index is not None else None

    def _primary_floor() -> int:
        index = _primary_index()
        return frame_floors.get(index, CROP_MIN_DIM) if index is not None else CROP_MIN_DIM

    cheque, cheque_warnings = merge_cheque(cheques)
    merge_warnings: list[str] = []
    if results:
        extraction, merge_warnings = merge(_mergeable())
        warnings = region_warnings + list(merge_warnings)
        if cheque is not None and extraction.document_type in IDENTITY_TYPES:
            # Neutral wording on purpose: a frame the detector or the reader took for a
            # cheque may have been anything (an old sefach strip read as a cheque, 2026-09-10).
            warnings.append("Identity document found; the other items on the page were skipped")
            cheque = None
    else:
        extraction, warnings = None, list(region_warnings)
    candidates: list[SefachExtraction] = []
    rescued = False
    corrected_card_id: ExtractedField | None = None
    for sefach, sheet, derived, floor in sefachs:
        # The rescue re-reads the holder cell through Ollama's block prompts: an Ollama-only
        # guard (the small model reads that block chaotically per crop; see rescue_sefach).
        if backend == "ollama" and extraction is not None and sefach.document_type == "teudat_zehut_sefach" \
                and sefach_needs_rescue(sefach, extraction):
            sefach, accepted = await rescue_sefach(sheet, sefach, extraction, floor)
            if accepted is not None:
                rescued = True
                if derived is not None:
                    results[derived] = sefach_to_document(sefach)
        settled = False
        if backend == "anthropic" and extraction is not None and sefach.document_type == "teudat_zehut_sefach" \
                and sefach_needs_rescue(sefach, extraction) and _primary_image() is not None:
            # This backend's rescue: read from its own crop, the spaced ID comes back with
            # its flanking digits swapped — about one read in six into a number that even
            # passes the check digit — so on a disagreement both crops get one targeted
            # re-read of the number alone, with the printed layout spelled out.
            card_id = await reread_id_anthropic(_primary_image(), _primary_floor())
            sefach_id = await reread_id_anthropic(sheet, floor)
            accepted = accept_reread_ids(sefach, extraction, card_id, sefach_id)
            if accepted is not None:
                sefach, card_field = accepted
                rescued = settled = True
                if derived is not None:
                    results[derived] = sefach_to_document(sefach)
                if card_field is not extraction.id_number:
                    corrected_card_id = card_field
                warnings.append("Card and sefach IDs disagreed and were re-read: both give the same printed number")
        if not settled and extraction is not None and sefach.document_type == "teudat_zehut_sefach":
            # A misread holder ID (fails its check digit) with the card's names on it is
            # the holder's paper; both backends, after any rescue. Re-merged below like a
            # rescue so the stale "different person" warning goes with it.
            matched = match_sefach_by_name(sefach, extraction)
            if matched is not None:
                sefach, card_id = matched
                rescued = True
                if derived is not None:
                    results[derived] = sefach_to_document(sefach)
                if card_id is not extraction.id_number:
                    corrected_card_id = card_id  # the card crop misread it; the sefach's number passes
                    warnings.append("Card ID failed its check digit; taken from the sefach, matched by name")
                else:
                    warnings.append("Sefach holder ID failed its check digit; matched to the card by name")
        if extraction is not None and sefach.document_type == "teudat_zehut_sefach":
            sefach, name_warnings = reconcile_sefach_names(sefach, extraction)
            warnings += name_warnings
        candidates.append(sefach)
    if corrected_card_id is not None and _primary_index() is not None:
        # The card crop misread its own number; the primary document carries the agreed
        # one from here on, so the re-merge below no longer sees a different person.
        results[_primary_index()].id_number = corrected_card_id
    if rescued:
        # Merge again so the corrected sefach fills gaps and its stale "different
        # person" warning is gone (the rescue warning above says what happened).
        rescue_notes = [w for w in warnings if w not in merge_warnings]
        extraction, merge_warnings = merge(_mergeable())
        warnings = merge_warnings + rescue_notes
    sefach, sefach_warnings = select_sefach(candidates, extraction)
    if candidates:
        # What became of the sheet is the sefach layer's to report — kept with the card's
        # number, kept with a caveat, or ignored as another person's — and it says why. The
        # merge sees the same ID disagreement from the other side and skips the derived
        # document, but its line adds nothing: where the sheet is kept it contradicts the
        # answer (a kept sefach and a warning that it was ignored cannot both stand), and
        # where it is dropped the client is told twice about one sheet.
        warnings = [w for w in warnings if not w.startswith("Ignored a teudat_zehut_sefach block")]
    classified_type: str | None = None
    # Only the primary result's own frame is consulted: a page whose recognised card is
    # not the primary document keeps `other` and is answered "not a document". A phase-1
    # corner, deliberate — the label describes the document the client is given.
    # The reader's vocabulary has none of the unsupported kinds, so on such a card it
    # answers "other" or the nearest identity type (a disabled-veteran card read as
    # teudat_zehut with the card's name and ID, 2026-09-10): a SURE classifier decides the
    # type either way, an unsure one only when the reader itself found no known type.
    if kinds is not None and extraction is not None:
        primary = _primary_index()
        if primary is not None and primary in frame_of_result:
            frame = frame_of_result[primary]
            kind = kinds[frame]
            if kind in UNSUPPORTED_KINDS and (extraction.document_type == "other" or sure[frame]):
                classified_type = kind
    # Nothing read (every frame skipped) is a result, not an error: main.py answers
    # "not a document". Before stage 3a this state was unreachable and raised.
    return PipelineResult(extraction=extraction, regions=region_results,
                          warnings=[*page.warnings, *warnings, *cheque_warnings, *sefach_warnings],
                          sefach=sefach, cheque=cheque, classified_type=classified_type)
