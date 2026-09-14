"""The Ollama backend: two-stage extraction (transcribe, then fill fields) against a
small local vision model, plus the sefach block reader and the cheque side reader.
Token caps and COMPACT_JSON exist because generation (~20 tokens/s locally) is the
bottleneck; see the comments on each constant for what was measured."""

import copy
from collections.abc import Callable

import httpx
from PIL import Image
from pydantic import ValidationError

from .. import config
from ..anchors import (
    GATED_BY_LABEL,
    anchor_cheque_reference,
    anchor_id,
    anchor_labels,
    anchor_names,
    anchor_parents,
    anchor_sex,
    anchor_type,
)
from ..cropping import (
    CROP_MIN_DIM,
    SEFACH_GRID_COLS,
    SEFACH_GRID_ROWS,
    SEFACH_STRIP_MIN_ASPECT,
    SEFACH_STRIP_ROW_INK_MARGIN,
    cheque_drawer_block,
    sefach_cells,
    sefach_old_blocks,
    sefach_strip_child_rows,
    sefach_strip_columns,
)
from ..errors import ConfigurationError, ExtractionError
from ..imaging import encode_jpeg, has_ink
from ..orientation import is_degenerate
from ..postprocess import (
    PASSPORT_TYPES,
    _cap_confidence,
    apply_drawer_block,
    assemble_sefach,
    assemble_sefach_old,
    passport_type_from_mrz,
    postprocess,
    postprocess_cheque,
    postprocess_sefach,
)
from ..schemas import (
    CHEQUE_TYPES,
    ChequeDrawerBlock,
    ChequeExtraction,
    DocumentExtraction,
    ExtractedField,
    SefachChildBlock,
    SefachExtraction,
    SefachHolderBlock,
    SefachOldBottomBlock,
    SefachOldTopBlock,
    SefachPerson,
    SefachStatusBlock,
    TranscribedLines,
)
from . import _log_usage, current_options
from .prompts import (
    CHEQUE_DRAWER_PROMPT,
    CHEQUE_DRAWER_SYSTEM_PROMPT,
    CHEQUE_SYSTEM_PROMPT,
    COMPACT_JSON,
    SEFACH_BLOCK_SYSTEM_PROMPT,
    SEFACH_CHILD_PROMPT,
    SEFACH_HOLDER_PROMPT,
    SEFACH_OLD_BOTTOM_PROMPT,
    SEFACH_OLD_SYSTEM_PROMPT,
    SEFACH_OLD_TOP_PROMPT,
    SEFACH_STATUS_PROMPT,
    SYSTEM_PROMPT,
    TRANSCRIBE_PROMPT,
)
from .schemas_flat import (
    _CHEQUE_PHRASE,
    _TYPE_HINTS,
    _TYPE_PHRASE,
    T,
    cheque_schema_for,
    extraction_schema_for,
    to_document_extraction,
    widen,
)

# Generation is the bottleneck (~20 tokens/s locally), so every call gets a token
# cap sized to its schema: a runaway generation (seen: 4096 tokens, 210 s, then a
# schema error) now costs at most a few dozen seconds before the retry.
DETECT_MAX_TOKENS = 256
TRANSCRIBE_MAX_TOKENS = 1024
EXTRACT_MAX_TOKENS = 700  # DocumentExtraction: ~250 tokens compact, 340-440 pretty-printed
SEFACH_BLOCK_MAX_TOKENS = 512  # one block: ~100-160 tokens
CHEQUE_MAX_TOKENS = 600  # ChequeFields: ~220 tokens compact; the back ~60
DRAWER_BLOCK_MAX_TOKENS = 256  # ChequeDrawerBlock: four short strings


# Free text is where the model rambles: one run spent 392 characters (~100 tokens,
# 5 s) on notes. Bounded in the Ollama-facing schema only (see _bound_schema); a note
# the bound cut short is closed at a whole word by _close_capped_notes.
NOTES_MAX_CHARS = 200
MRZ_MAX_LINES, MRZ_MAX_LINE_CHARS = 3, 44
MICR_MAX_CHARS = 60  # the printed line is ~30 chars; anything longer is the model looping


# Larger = more legible text but more image tokens. Ollama/Qwen re-downscale
# internally, so cropping tight matters more than raw size.
DETECT_MAX_DIM = 1024


def _bound_schema(schema: dict) -> dict:
    """The JSON schema sent to Ollama, with the free-text fields length-bounded.

    Applied here rather than on the Pydantic models so the API contract and the
    Anthropic structured-output schema stay as they are."""
    schema = copy.deepcopy(schema)
    props = schema.get("properties", {})
    for option in props.get("notes", {}).get("anyOf", []):
        if option.get("type") == "string":
            option["maxLength"] = NOTES_MAX_CHARS
    for option in props.get("mrz_lines", {}).get("anyOf", []):
        if option.get("type") == "array":
            option["maxItems"] = MRZ_MAX_LINES
            option.setdefault("items", {})["maxLength"] = MRZ_MAX_LINE_CHARS
    for option in props.get("micr_line", {}).get("anyOf", []):
        if option.get("type") == "string":
            option["maxLength"] = MICR_MAX_CHARS
    # The flat schemas' uncertain_fields is a list of field names. Unbounded, the model
    # can loop on it — on a clean cheque photo it repeated four names until the cap
    # (600/600 on both attempts) with every field already read. No document has more
    # uncertain fields than fields, so the enum's size is the bound.
    uncertain = props.get("uncertain_fields", {})
    if uncertain.get("type") == "array" and "enum" in uncertain.get("items", {}):
        uncertain["maxItems"] = len(uncertain["items"]["enum"])
    return schema


async def _ollama_json(
    image_b64: str, system: str | None, user: str, schema: type[T], num_predict: int,
    retry_b64: str | None = None, degenerate: Callable[[T], bool] | None = None,
    model: str | None = None,
) -> T:
    """One schema-constrained call. A generation that runs into `num_predict`
    (the model occasionally loops; temperature 0 is not deterministic here) is
    retried once before giving up. When the caller supplies `retry_b64`, the retry uses
    those pixels instead: an identical retry on a looping crop was measured to loop the
    same way twice. `degenerate`, when given together with `retry_b64`, treats a result
    that parses fine but looped (hits the cap yet happens to close its JSON — the model
    can do that too) exactly like a truncation: one retry, on the rotated pixels, never a
    second call on the same ones that just produced it. A still-degenerate retry is
    returned rather than raised — a noisy transcript is better than none. `model`
    overrides the request's model for this call (the classifier's cheaper model);
    `None` is the request's model."""
    def _payload(images_b64: str) -> dict:
        return {
            "model": model or current_options().model,
            "stream": False,
            # NB: do not send "think": false — as of Ollama 0.32 it makes qwen3-vl
            # return empty content. Use an -instruct tag instead.
            "format": _bound_schema(schema.model_json_schema()),
            "options": {"temperature": 0, "num_predict": num_predict, "num_ctx": 16384},
            "keep_alive": config.OLLAMA_KEEP_ALIVE,
            "messages": ([{"role": "system", "content": system}] if system else [])
            + [{"role": "user", "content": user, "images": [images_b64]}],
        }

    for attempt in range(2):
        payload_b64 = image_b64 if attempt == 0 or retry_b64 is None else retry_b64
        try:
            result = await _ollama_call(_payload(payload_b64), schema, model=model)
        except _TruncatedOutput as exc:
            if attempt:
                raise ExtractionError(str(exc)) from exc
            continue
        # Only worth a retry when there is a different payload to send — retrying a
        # degenerate result with the identical pixels would just loop the same way again.
        if attempt == 0 and retry_b64 is not None and degenerate is not None and degenerate(result):
            continue
        return result
    raise AssertionError("unreachable")


class _TruncatedOutput(ExtractionError):
    """The model's output hit num_predict and does not validate — worth one retry."""


async def _ollama_call(payload: dict, schema: type[T], model: str | None = None) -> T:
    model = model or current_options().model
    try:
        async with httpx.AsyncClient(timeout=config.OLLAMA_TIMEOUT_SECONDS) as http:
            response = await http.post(f"{config.OLLAMA_URL}/api/chat", json=payload)
    except httpx.ConnectError as exc:
        raise ConfigurationError(
            f"Cannot reach Ollama at {config.OLLAMA_URL}. Install it (https://ollama.com) "
            f"and run: ollama pull {model}"
        ) from exc
    except httpx.TimeoutException as exc:
        raise ExtractionError("Local model timed out — try a smaller model or a smaller image") from exc

    if response.status_code == 404:
        raise ConfigurationError(f"Model {model!r} not found in Ollama. Run: ollama pull {model}")
    if response.status_code != 200:
        raise ExtractionError(f"Ollama error {response.status_code}: {response.text[:200]}")

    body = response.json()
    total_ns = body.get("total_duration")
    _log_usage(
        "ollama", schema, model=model,
        input_tokens=body.get("prompt_eval_count"),
        output_tokens=body.get("eval_count"),
        done_reason=body.get("done_reason"),
        total_s=round(total_ns / 1e9, 2) if total_ns else None,
    )
    content = body.get("message", {}).get("content", "")
    if not content.strip():
        raise ExtractionError("Local model returned an empty response — try again or use a larger model")
    try:
        return _close_capped_notes(schema.model_validate_json(content))
    except ValidationError as exc:
        # Report field paths and error types, but never the extracted values (PII).
        issues = "; ".join(f"{'.'.join(str(p) for p in err['loc'])}: {err['type']}" for err in exc.errors()[:5])
        if body.get("done_reason") == "length":
            raise _TruncatedOutput(f"Local model output failed schema validation (response hit the token limit): {issues}") from exc
        raise ExtractionError(f"Local model output failed schema validation: {issues}") from exc


def _close_capped_notes(result: T) -> T:
    """A note that reached NOTES_MAX_CHARS was stopped by the schema bound, usually in the
    middle of a word, and it is published as a warning. End it at its last whole word with
    an ellipsis, so it reads as cut short rather than as a sentence that breaks off."""
    notes = getattr(result, "notes", None)
    if not isinstance(notes, str) or len(notes) < NOTES_MAX_CHARS:
        return result
    head = notes[:NOTES_MAX_CHARS]
    if not head[-1].isspace() and " " in head:
        head = head[: head.rindex(" ")]  # the last word is unfinished
    result.notes = head.rstrip(" ;,:.-–—") + "…"
    return result


async def installed_models() -> list[str] | None:
    """The tags pulled into Ollama (`GET /api/tags`), for GET /models; None when Ollama
    cannot be reached or answers with an error — the caller shows "not reachable", never
    an empty list that would read as "nothing installed"."""
    try:
        async with httpx.AsyncClient(timeout=config.OLLAMA_TAGS_TIMEOUT_SECONDS) as http:
            response = await http.get(f"{config.OLLAMA_URL}/api/tags")
        if response.status_code != 200:
            return None
        body = response.json()
        # Ollama answers with an object holding a list of objects, but the contract here is
        # "a list of tags, or None for anything that went wrong" — and a settings page must
        # never read a shape error as "nothing is installed". Anything else is None, not a
        # raised AttributeError past this except.
        if not isinstance(body, dict):
            return None
        models = body.get("models")
        if not isinstance(models, list) or any(not isinstance(m, dict) for m in models):
            return None
        return [str(m.get("name", "")) for m in models]
    except (httpx.HTTPError, ValueError):
        return None


Transcribed = tuple[str, dict, frozenset[str]]  # (transcript text for the prompt, field anchors, printed labels)

# How many transcribed lines travel into the field-extraction prompt. The longest honest
# transcript in the corpus is a sefach sheet at ~90 lines; past this a transcript is the
# repetition loop of §3b, which `is_degenerate` already rejects — this is the backstop for
# a long-but-not-degenerate one, and it keeps the stage-B prompt bounded.
TRANSCRIPT_MAX_LINES = 120


async def _transcribe_ollama(image_b64: str, region_image: Image.Image | None = None, floor: int = CROP_MIN_DIM) -> Transcribed:
    """Stage A: raw text lines (best-effort), the field anchors derived from them (names,
    sex) and the set of layout-dependent fields whose label is printed.

    Upside-down Hebrew makes the model repeat one short line until the token cap
    (measured: 134 lines of 4 distinct, 84 of 7). A blind retry re-sends identical pixels
    and loops the same way twice, so when `region_image` is given, the 180-degree rotated
    crop is offered as `retry_b64`, and `is_degenerate` is passed as `_ollama_json`'s
    `degenerate` predicate: the one bounded retry there fires on the rotated crop both for
    an output that hits the cap and fails to parse, and for one that hits the cap but
    happens to parse anyway (no exception raised, so nothing else would catch it) — the
    retry policy lives in one place, never resending pixels that just produced the loop.

    A transcript that loops to the end is returned as nothing at all. It anchors nothing —
    every anchor reads printed labels and their neighbours — and its repeated lines used
    to travel into the field prompt as if they were the document: measured on an old
    laminated card (30B, 2026-09-11), the fields come back byte-identical whether
    that transcript is sent or not, at 60 s a page. Returning "" makes the blind read
    visible to the caller instead of hiding it behind 120 lines of "x"."""
    retry_b64 = (
        encode_jpeg(region_image.rotate(180, expand=True), config.MAX_IMAGE_DIMENSION, min_dim=floor)
        if region_image is not None else None
    )
    try:
        lines = await _ollama_json(
            image_b64, None, TRANSCRIBE_PROMPT, TranscribedLines, TRANSCRIBE_MAX_TOKENS,
            retry_b64=retry_b64, degenerate=lambda parsed: is_degenerate(parsed.lines),
        )
    except ExtractionError:
        return "", {}, frozenset()  # fall back to single-stage extraction
    if not lines.lines or is_degenerate(lines.lines):
        return "", {}, frozenset()
    transcript = "Transcribed text lines, top to bottom:\n" + "\n".join(
        f"{i + 1}. {line}" for i, line in enumerate(lines.lines[:TRANSCRIPT_MAX_LINES])
    )
    anchors = anchor_names(lines.lines)
    anchors = anchor_parents(lines.lines, with_holder="first_name_he" not in anchors) | anchors
    sex = anchor_sex(lines.lines)
    if sex:
        anchors["sex"] = sex
    id_number = anchor_id(lines.lines)
    if id_number:
        anchors["id_number"] = id_number
    anchors |= anchor_cheque_reference(lines.lines)  # cheque fields; postprocess() skips them on identity documents
    anchored_type = anchor_type(lines.lines)
    if anchored_type:
        anchors["_type"] = anchored_type  # consumed by _extract_fields_ollama, never a field
    return transcript, anchors, frozenset(anchor_labels(lines.lines))


def _stage_b_prompt(transcript: str, what: str, hint: str = "") -> str:
    ask = (
        f"{transcript}\n\nUsing the image and this transcript of its lines, extract all fields{what}."
        if transcript else f"Extract all fields{what}."
    )
    if hint:
        ask = f"{ask}\n\n{hint}"
    return f"{ask} {COMPACT_JSON}"


async def _extract_fields_ollama(
    image_b64: str, transcript: str, anchors: dict, expected_type: str | None = None, printed: frozenset[str] = frozenset(),
) -> DocumentExtraction:
    anchors = dict(anchors)
    # A printed title outranks the detector's and the classifier's guess about the type:
    # the typed schema is the only way the card's own fields can come back.
    anchored_type = anchors.pop("_type", None)
    labelled_type, expected_type = expected_type, anchored_type or expected_type
    schema, generic = extraction_schema_for(expected_type), extraction_schema_for(None)
    result = await _ollama_json(
        image_b64, SYSTEM_PROMPT,
        _stage_b_prompt(transcript, _TYPE_PHRASE.get(expected_type, ""), _TYPE_HINTS.get(expected_type, "")),
        schema, EXTRACT_MAX_TOKENS,
    )
    if schema is not generic and result.document_type != expected_type:
        if anchored_type and getattr(result, "file_number", None):
            # The title, not the model's own self-report, says what this is (measured on
            # the disabled-veteran card, 30B, 2026-09-11: read with this very schema, every
            # field — file_number, the Latin names, the MM.YYYY expiry — comes back right,
            # and document_type still says "teudat_zehut"). Keep the read the schema
            # already produced; only the label was wrong. Gated on file_number — evidence
            # exclusive to this type — because the title anchor can itself be a false
            # positive (a corrupted ID-card title scoring above its match threshold): a
            # read with no such evidence is redone un-anchored below, and the model's own
            # (correct) self-report wins.
            result = result.model_copy(update={"document_type": anchored_type})
        elif anchored_type:
            # The anchor was the false positive, not the model: redo the read exactly as
            # if no title had been found, on the detector's/classifier's own label. That
            # is the whole pre-anchor path back — the typed schema for that label, its own
            # generic re-read, the gated-field recovery (place_of_birth and the parents on
            # an old laminated card) and the MRZ retype — where falling straight into the
            # generic re-read below would silently drop the gated fields. One extra call,
            # and only on a false anchor; `anchors` no longer carries "_type", so the
            # recursive read cannot anchor again.
            return await _extract_fields_ollama(image_b64, transcript, anchors, labelled_type, printed)
        else:
            # The detector was wrong about the type; the slim schema may have hidden fields.
            result = await _ollama_json(image_b64, SYSTEM_PROMPT, _stage_b_prompt(transcript, ""), generic, EXTRACT_MAX_TOKENS)
    elif schema is generic and result.document_type in GATED_BY_LABEL:
        # The other direction: a layout-dependent field whose label the transcript shows
        # came back empty from the wide schema (the old laminated card's place of birth:
        # null 3/3 with the generic schema, read 3/3 with the card's own). One re-read.
        missing = [f for f in GATED_BY_LABEL[result.document_type]
                   if f in printed and f not in anchors and getattr(result, f, None) is None]
        if missing:
            typed = extraction_schema_for(result.document_type)
            retry = await _ollama_json(
                image_b64, SYSTEM_PROMPT,
                _stage_b_prompt(transcript, _TYPE_PHRASE.get(result.document_type, ""), _TYPE_HINTS.get(result.document_type, "")),
                typed, EXTRACT_MAX_TOKENS,
            )
            if retry.document_type == result.document_type:
                result = retry
    mrz_type = passport_type_from_mrz(getattr(result, "mrz_lines", None))
    if mrz_type and result.document_type in PASSPORT_TYPES and result.document_type != mrz_type:
        # The MRZ's issuing state outranks the model's type (postprocess.passport_type_from_mrz).
        # One read with the right passport's own schema and phrase — before postprocess
        # nulls the fields the wrong type does not carry (an Israeli passport's Hebrew
        # names and ID); when even that read disagrees, the MRZ still names the type.
        typed = extraction_schema_for(mrz_type)
        retry = await _ollama_json(
            image_b64, SYSTEM_PROMPT,
            _stage_b_prompt(transcript, _TYPE_PHRASE.get(mrz_type, ""), _TYPE_HINTS.get(mrz_type, "")),
            typed, EXTRACT_MAX_TOKENS,
        )
        result = (retry if retry.document_type == mrz_type else result).model_copy(update={"document_type": mrz_type})
    return postprocess(to_document_extraction(result), anchors, printed)


async def _extract_sefach_sheet_ollama(
    sheet: Image.Image, floor: int = CROP_MIN_DIM, child_rows: list[Image.Image] = (),
) -> SefachExtraction | None:
    """Older single-page sefach: two block calls (upper = identity + address, lower =
    status / spouse / nationality / previous names), no transcript. None when the upper
    block yields no holder identity. One schema over the whole sheet was measured to
    smear the nationality into the blank name fields and to invent a birth date.
    `child_rows` are the strip layout's child slots (see _extract_sefach_strip_ollama):
    one child call per row that carries black ink, as the grid path does per cell."""
    upper, lower = sefach_old_blocks(sheet)
    top = await _ollama_json(_cell_b64(upper, floor), SEFACH_OLD_SYSTEM_PROMPT, SEFACH_OLD_TOP_PROMPT,
                             SefachOldTopBlock, SEFACH_BLOCK_MAX_TOKENS)
    if not any((top.id_number, top.last_name_he, top.first_name_he)):
        return None
    bottom = await _ollama_json(_cell_b64(lower, floor), SEFACH_OLD_SYSTEM_PROMPT, SEFACH_OLD_BOTTOM_PROMPT,
                                SefachOldBottomBlock, SEFACH_BLOCK_MAX_TOKENS)
    children: list[SefachPerson] = []
    for row in child_rows:
        if not has_ink(row, SEFACH_STRIP_ROW_INK_MARGIN):
            continue
        block = await _ollama_json(_cell_b64(row, floor), SEFACH_BLOCK_SYSTEM_PROMPT, SEFACH_CHILD_PROMPT,
                                   SefachChildBlock, SEFACH_BLOCK_MAX_TOKENS)
        children.append(block.child)
    return postprocess_sefach(assemble_sefach_old(top, bottom, children))


async def _extract_sefach_strip_ollama(strip: Image.Image, floor: int = CROP_MIN_DIM) -> SefachExtraction | None:
    """The old layout as a two-column strip: the holder column read as the single-column
    sheet, the children column as four slots (cropping.SEFACH_STRIP_*). The 2x4 grid of
    the current sheet cut this strip into cells that mixed the holder's lines into
    invented children and lost the address, status and nationality (2026-09-10)."""
    holder, children = sefach_strip_columns(strip)
    return await _extract_sefach_sheet_ollama(holder, floor, sefach_strip_child_rows(children))


def _cell_b64(cell: Image.Image, floor: int = CROP_MIN_DIM) -> str:
    return encode_jpeg(cell, config.MAX_IMAGE_DIMENSION, min_dim=floor)


async def _extract_sefach_grid_ollama(sheet: Image.Image, floor: int = CROP_MIN_DIM) -> SefachExtraction | None:
    """Current-layout sefach: one small model call per non-empty block of the
    2x4 grid, no transcription stage. None when the top-right block yields no
    holder identity (not this layout, or not a sefach at all)."""
    cells = {(row, col): cell for row, col, cell in sefach_cells(sheet)}
    holder_cell = cells[(0, 0)]
    if not has_ink(holder_cell):
        return None
    holder = await _ollama_json(_cell_b64(holder_cell, floor), SEFACH_BLOCK_SYSTEM_PROMPT, SEFACH_HOLDER_PROMPT,
                                SefachHolderBlock, SEFACH_BLOCK_MAX_TOKENS)
    if not any((holder.id_number, holder.last_name_he, holder.first_name_he)):
        return None

    status: SefachStatusBlock | None = None
    if has_ink(cells[(0, 1)]):
        status = await _ollama_json(_cell_b64(cells[(0, 1)], floor), SEFACH_BLOCK_SYSTEM_PROMPT, SEFACH_STATUS_PROMPT,
                                    SefachStatusBlock, SEFACH_BLOCK_MAX_TOKENS)

    children: list[SefachPerson] = []
    for row in range(1, SEFACH_GRID_ROWS):
        for col in range(SEFACH_GRID_COLS):
            cell = cells[(row, col)]
            if not has_ink(cell):
                continue
            block = await _ollama_json(_cell_b64(cell, floor), SEFACH_BLOCK_SYSTEM_PROMPT, SEFACH_CHILD_PROMPT,
                                       SefachChildBlock, SEFACH_BLOCK_MAX_TOKENS)
            children.append(block.child)
    return postprocess_sefach(assemble_sefach(holder, status, children))


def sefach_to_document(sefach: SefachExtraction) -> DocumentExtraction:
    """The holder block as a DocumentExtraction so the sefach can take part in
    merge() like any other region (and stand alone when it is the only document)."""
    def absent() -> ExtractedField:
        return ExtractedField(value=None, confidence="high")

    return DocumentExtraction(
        document_type="teudat_zehut_sefach",
        last_name_he=sefach.last_name_he.model_copy(),
        first_name_he=sefach.first_name_he.model_copy(),
        last_name_en=absent(),
        first_name_en=absent(),
        id_number=sefach.id_number.model_copy(),
        passport_number=absent(),
        date_of_birth=sefach.date_of_birth.model_copy(),
        sex=absent(),
        nationality=absent(),
        place_of_birth=sefach.place_of_birth.model_copy(),
        father_name_he=sefach.father_name_he.model_copy(),
        mother_name_he=sefach.mother_name_he.model_copy(),
        date_of_issue=sefach.date_of_issue.model_copy(),
        date_of_expiry=absent(),
        license_number=absent(),
        address=absent(),
        categories=absent(),
        file_number=absent(),
        mrz_lines=None,
        notes=sefach.notes,
    )


async def _extract_region_ollama(
    region_image: Image.Image, expect_sefach: bool, expected_type: str | None = None,
    transcribed: Transcribed | None = None, floor: int = CROP_MIN_DIM,
) -> tuple[DocumentExtraction, SefachExtraction | None, Transcribed | None]:
    """Extraction of one detected region (or the whole image).

    Generic documents are two-stage: transcribe lines first, then map to fields.
    Small local models read text well line-by-line but mis-assign values when
    asked to fill a large schema straight from pixels (e.g. first name landing
    in last_name). Feeding the model its own transcript alongside the image
    anchors the field mapping; `anchor_names` then pins the names by their
    printed labels, and `postprocess` drops fields the document cannot carry.

    A region the detector labelled as sefach is read block by block instead
    (`_extract_sefach_grid_ollama`) and the DocumentExtraction the merge needs
    is derived from it. Fallbacks: whole-sheet sefach schema (older single-page
    layout) and finally the generic schema. If the detector mislabelled a sefach,
    the generic schema's document_type sends it down the sefach path afterwards.
    """
    image_b64 = encode_jpeg(region_image, config.MAX_IMAGE_DIMENSION, min_dim=floor)

    async def sefach_any_layout(transcript: str | None) -> SefachExtraction | None:
        w, h = region_image.size
        sefach = await _extract_sefach_strip_ollama(region_image, floor) if w / h >= SEFACH_STRIP_MIN_ASPECT else None
        if sefach is None:
            sefach = await _extract_sefach_grid_ollama(region_image, floor)
        if sefach is None:
            sefach = await _extract_sefach_sheet_ollama(region_image, floor)
        return sefach

    if expect_sefach:
        sefach = await sefach_any_layout(transcribed[0] if transcribed else None)
        if sefach is not None:
            return sefach_to_document(sefach), sefach, transcribed
    if transcribed is None:
        transcribed = await _transcribe_ollama(image_b64, region_image, floor)
    transcript, anchors, printed = transcribed
    doc = await _extract_fields_ollama(image_b64, transcript, anchors, expected_type, printed)
    sefach = None
    if not expect_sefach and doc.document_type == "teudat_zehut_sefach":
        sefach = await sefach_any_layout(transcript)
    return doc, sefach, transcribed


def _cheque_is_blank(cheque: ChequeExtraction) -> bool:
    return not (cheque.guarantor_name.value or cheque.guarantor_id_number.value)


async def _cheque_fields_ollama(image_b64: str, side: str, transcript: str, anchors: dict | None = None) -> ChequeExtraction:
    # "_type" is the title anchor, consumed by _extract_fields_ollama and meaningless here;
    # postprocess_cheque skips unknown keys, so forwarding it was inert rather than wrong —
    # but the invariant "what reaches postprocess_cheque is field anchors" is worth having
    # structurally instead of by luck.
    anchors = {k: v for k, v in anchors.items() if not k.startswith("_")} if anchors else anchors
    result = await _ollama_json(
        image_b64, CHEQUE_SYSTEM_PROMPT, _stage_b_prompt(transcript, _CHEQUE_PHRASE[side]),
        cheque_schema_for(side), CHEQUE_MAX_TOKENS,
    )
    cheque = widen(result, ChequeExtraction)
    # Which fields this answer may hold is decided by the schema it was read with, not by
    # the label the model put on it: a front-schema answer labelled "cheque_back" still
    # holds only front fields, and postprocess_cheque's back-only filter would empty it.
    # The label itself is the caller's business (it decides whether to re-read).
    claimed, cheque.document_type = cheque.document_type, side
    cheque = postprocess_cheque(cheque, anchors)
    cheque.document_type = claimed
    # The 8B model invents a payee on a blank line and says "high": in the 2026-08-22
    # verification none of the four high-confidence payees was right. On this backend the
    # payee is therefore never more than medium — the caller must not trust it blindly.
    if cheque.payee.value:
        cheque.payee.confidence = _cap_confidence(cheque.payee.confidence)
    return cheque


async def _extract_cheque_ollama(
    region_image: Image.Image, side: str, transcribed: Transcribed | None = None, floor: int = CROP_MIN_DIM,
) -> tuple[ChequeExtraction, Transcribed]:
    """One cheque side: transcribe (unless a transcription is passed in), then fields
    with the side's flat schema. If the model names the other side, the region is read
    once more with that side's schema — each side's schema hides the other's fields
    entirely (a back read as a front can never return the guarantor), the same reason
    `_extract_fields_ollama` re-runs on a type the detector got wrong; that second read
    is accepted only when it confirms the new side, otherwise the first answer (the only
    one carrying fields) is kept. The back's
    guarantee stamp is usually rotated 90°, so an empty back is retried on the crop
    rotated clockwise, then counter-clockwise — no second transcription, at most three
    extra calls."""
    image_b64 = encode_jpeg(region_image, config.MAX_IMAGE_DIMENSION, min_dim=floor)
    if transcribed is None:
        transcribed = await _transcribe_ollama(image_b64, region_image, floor)
    transcript, anchors, _ = transcribed
    cheque = await _cheque_fields_ollama(image_b64, side, transcript, anchors)
    if cheque.document_type in CHEQUE_TYPES and cheque.document_type != side:
        other_side = cheque.document_type
        candidate = await _cheque_fields_ollama(image_b64, other_side, transcript, anchors)
        if candidate.document_type == other_side:
            side, cheque = other_side, candidate
        else:
            # The model flip-flops: read as a front it says "back", read as a back it
            # says "front". Only the first answer holds any fields (each side's schema
            # hides the other's), so keep it and pin it to the schema it was read with.
            cheque.document_type = side
    if side == "cheque" and cheque.document_type == "cheque":
        # The drawer block on its own crop: the whole-front read leaves the four drawer
        # fields empty on 10 of the 13 sample cheques and copies the branch's address and
        # phone into them on another (2026-09-10). Best-effort like the rotated retry.
        try:
            block = await _ollama_json(
                _cell_b64(cheque_drawer_block(region_image), floor), CHEQUE_DRAWER_SYSTEM_PROMPT, CHEQUE_DRAWER_PROMPT,
                ChequeDrawerBlock, DRAWER_BLOCK_MAX_TOKENS,
            )
        except ExtractionError:
            block = None
        if block is not None:
            cheque = apply_drawer_block(cheque, block)
    if side == "cheque_back" and cheque.document_type == "cheque_back" and _cheque_is_blank(cheque):
        for angle in (-90, 90):  # PIL: negative = clockwise
            rotated_b64 = encode_jpeg(region_image.rotate(angle, expand=True), config.MAX_IMAGE_DIMENSION, min_dim=floor)
            try:
                candidate = await _cheque_fields_ollama(rotated_b64, side, transcript, anchors)
            except ExtractionError:
                # The rotation is a best-effort extra, like _transcribe_ollama: keep the
                # blank back (and any cheque already read) rather than fail the request.
                break
            if candidate.document_type == "cheque_back" and not _cheque_is_blank(candidate):
                return candidate, transcribed
    return cheque, transcribed
