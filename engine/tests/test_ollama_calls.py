"""Unit tests for the Ollama call wrapper in app/reading/backend_ollama.py — the HTTP
layer is faked (monkeypatched httpx post), everything else is the real code path."""

import asyncio
import json

import httpx
import pytest
from PIL import Image
from pydantic import BaseModel

from app import config, doctypes, pipeline, reading
from app.cropping import Frame
from app.errors import ExtractionError
from app.reading.backend_ollama import _bound_schema, _extract_fields_ollama, _ollama_json, _stage_b_prompt, installed_models
from app.reading.schemas_flat import extraction_schema_for
from app.schemas import DocumentExtraction, TranscribedLines

GOOD = json.dumps({"lines": ["a", "b"]})
TRUNCATED = '{"lines": ["a", "b"'


def _fake_post(replies):
    """httpx.AsyncClient.post replacement: returns canned Ollama bodies in order."""
    calls = []

    async def post(self, url, *args, json=None, **kwargs):
        calls.append(json)
        content, done_reason = replies[len(calls) - 1]
        body = {"message": {"content": content}, "done_reason": done_reason}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    return post, calls


def test_ollama_json_retries_once_when_the_output_hit_the_token_limit(monkeypatch):
    post, calls = _fake_post([(TRUNCATED, "length"), (GOOD, "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    result = asyncio.run(_ollama_json("img", None, "prompt", TranscribedLines, 64))
    assert result.lines == ["a", "b"]
    assert len(calls) == 2


def test_ollama_json_gives_up_after_the_second_truncated_output(monkeypatch):
    post, calls = _fake_post([(TRUNCATED, "length"), (TRUNCATED, "length")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with pytest.raises(ExtractionError, match="token limit"):
        asyncio.run(_ollama_json("img", None, "prompt", TranscribedLines, 64))
    assert len(calls) == 2


def test_ollama_json_does_not_retry_a_schema_violation_that_was_not_truncated(monkeypatch):
    post, calls = _fake_post([('{"lines": "not a list"}', "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with pytest.raises(ExtractionError):
        asyncio.run(_ollama_json("img", None, "prompt", TranscribedLines, 64))
    assert len(calls) == 1


class _Noted(BaseModel):
    notes: str | None = None


def test_a_note_cut_by_the_length_bound_ends_at_a_whole_word(monkeypatch):
    cap = reading.backend_ollama.NOTES_MAX_CHARS
    mid_word = ("word " * cap)[: cap - 3] + "unfin"  # the bound stopped inside "unfinished"
    post, _ = _fake_post([(json.dumps({"notes": mid_word[:cap]}), "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    notes = asyncio.run(_ollama_json("img", None, "prompt", _Noted, 64)).notes
    assert notes.endswith("word…") and "unf" not in notes and len(notes) <= cap

    at_space = ("abc; " * cap)[:cap]  # the bound stopped right after a separator
    assert reading.backend_ollama._close_capped_notes(_Noted(notes=at_space)).notes.endswith("abc…")


def test_a_note_under_the_length_bound_is_left_alone():
    assert reading.backend_ollama._close_capped_notes(_Noted(notes="glare on the MRZ")).notes == "glare on the MRZ"
    assert reading.backend_ollama._close_capped_notes(_Noted(notes=None)).notes is None


def test_ollama_json_sends_the_bounded_schema_and_the_token_cap(monkeypatch):
    post, calls = _fake_post([(GOOD, "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    asyncio.run(_ollama_json("img", None, "prompt", TranscribedLines, 64))
    assert calls[0]["options"]["num_predict"] == 64
    assert calls[0]["format"] == _bound_schema(TranscribedLines.model_json_schema())


# --------------------------------------------------------------------------- transcribe retry

def _fake_call(replies):
    """_ollama_call replacement: records the exact payload dict handed to it and returns
    canned TranscribedLines parses in order. Patching at this level (below the HTTP layer,
    same as production code calls it) proves the image bytes _ollama_json actually sent —
    not just that some higher mock was invoked a certain number of times."""
    calls = []

    async def call(payload, schema, model=None):
        calls.append(payload)
        return schema.model_validate_json(replies[len(calls) - 1])

    return call, calls


def test_transcribe_ollama_retries_rotated_when_the_transcript_loops(monkeypatch):
    degenerate = json.dumps({"lines": ["x"] * 25})
    clean = json.dumps({"lines": [f"line {i}" for i in range(28)]})
    call, calls = _fake_call([degenerate, clean])
    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", call)
    region = Image.new("RGB", (40, 20), "white")

    transcript, _, _ = asyncio.run(reading.backend_ollama._transcribe_ollama("ORIGINAL_B64", region))

    assert len(calls) == 2
    first_images = calls[0]["messages"][-1]["images"]
    second_images = calls[1]["messages"][-1]["images"]
    assert first_images != second_images  # the retry sent different bytes, not the same crop again
    assert "line 0" in transcript  # kept the clean rotated result, not the looping one


def test_transcribe_ollama_does_not_retry_a_looping_transcript_with_no_region_image(monkeypatch):
    degenerate = json.dumps({"lines": ["x"] * 25})
    call, calls = _fake_call([degenerate])
    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", call)

    asyncio.run(reading.backend_ollama._transcribe_ollama("ORIGINAL_B64"))

    assert len(calls) == 1  # nothing to rotate, so no point resending the same pixels


def test_transcribe_ollama_returns_nothing_when_the_transcript_still_loops(monkeypatch):
    """A looping transcript is not a noisy transcript: its 120 repeated lines used to go
    into the field prompt, where they anchor nothing. Measured on an old laminated card,
    30B, 2026-09-11: the fields come back byte-identical with it and without it."""
    degenerate = json.dumps({"lines": ["x"] * 25})
    call, calls = _fake_call([degenerate, degenerate])
    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", call)
    region = Image.new("RGB", (40, 20), "white")

    transcript, anchors, printed = asyncio.run(
        reading.backend_ollama._transcribe_ollama("ORIGINAL_B64", region)
    )

    assert len(calls) == 2  # the rotated retry still fires while orientation is unknown
    assert (transcript, anchors, printed) == ("", {}, frozenset())


def test_the_transcript_sent_to_stage_b_is_bounded_by_a_named_constant(monkeypatch):
    """The bound is a measured number, not an accident of the line that carries it."""
    many = json.dumps({"lines": [f"line {i}" for i in range(reading.backend_ollama.TRANSCRIPT_MAX_LINES + 40)]})
    call, _ = _fake_call([many])
    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", call)

    transcript, _, _ = asyncio.run(reading.backend_ollama._transcribe_ollama("B64"))

    numbered = [ln for ln in transcript.splitlines() if ln[:1].isdigit()]
    assert len(numbered) == reading.backend_ollama.TRANSCRIPT_MAX_LINES


# --------------------------------------------------------------------------- the blind read


def _flat_answer(label: str) -> str:
    """A minimal valid answer for the flat schema a labelled frame is read with."""
    schema = extraction_schema_for(label)
    payload = dict.fromkeys(schema.model_fields)
    payload["document_type"] = label
    payload["uncertain_fields"] = []
    return json.dumps(payload)


def _frame():
    return Frame(image=Image.new("RGB", (400, 250), "white"), label="id_card_front")


def test_read_frame_reports_a_read_the_transcript_could_not_anchor(monkeypatch):
    """Without a transcript there are no anchors and no printed labels, so the label gate
    empties every layout-dependent field. The caller has to be able to tell that from
    "this document does not print them"."""
    looping = json.dumps({"lines": ["x"] * 25})
    call, _ = _fake_call([looping, looping, _flat_answer("teudat_zehut")])
    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", call)

    outcome = asyncio.run(reading.read_frame(_frame()))

    assert outcome.blind is True


def test_read_frame_is_not_blind_when_the_transcription_reads(monkeypatch):
    lines = json.dumps({"lines": [f"line {i}" for i in range(28)]})
    call, _ = _fake_call([lines, _flat_answer("teudat_zehut")])
    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", call)

    outcome = asyncio.run(reading.read_frame(_frame()))

    assert outcome.blind is False


# --------------------------------------------------------------------------- schema bounds

def test_bound_schema_caps_free_text_notes_and_mrz_lines():
    schema = _bound_schema(DocumentExtraction.model_json_schema())
    notes = schema["properties"]["notes"]
    assert any(opt.get("maxLength") == reading.backend_ollama.NOTES_MAX_CHARS for opt in notes["anyOf"])
    mrz = next(opt for opt in schema["properties"]["mrz_lines"]["anyOf"] if opt.get("type") == "array")
    assert mrz["maxItems"] == 3
    assert mrz["items"]["maxLength"] == 44


def test_bound_schema_caps_the_micr_line():
    schema = _bound_schema(reading.schemas_flat.cheque_schema_for("cheque").model_json_schema())
    micr = next(opt for opt in schema["properties"]["micr_line"]["anyOf"] if opt.get("type") == "string")
    assert micr["maxLength"] == reading.backend_ollama.MICR_MAX_CHARS


def test_bound_schema_caps_uncertain_fields_at_the_number_of_fields():
    # A flat schema's uncertain_fields is a list of field names; unbounded, the 8B model
    # repeated four names until the token cap on a clean cheque photo (600/600, twice).
    # No document has more uncertain fields than it has fields, so that is the bound.
    schema = _bound_schema(reading.schemas_flat.cheque_schema_for("cheque").model_json_schema())
    uncertain = schema["properties"]["uncertain_fields"]
    assert uncertain["maxItems"] == len(uncertain["items"]["enum"])


def test_bound_schema_leaves_other_schemas_untouched():
    assert _bound_schema(TranscribedLines.model_json_schema()) == TranscribedLines.model_json_schema()


# --------------------------------------------------------------------------- prompts

def test_stage_b_prompt_asks_for_compact_json_with_and_without_a_transcript():
    assert _stage_b_prompt("1. line", "").endswith(reading.prompts.COMPACT_JSON)
    assert _stage_b_prompt("", " of this sefach").endswith(reading.prompts.COMPACT_JSON)
    assert "1. line" in _stage_b_prompt("1. line", "")


def test_transcription_prompt_does_not_ask_for_compact_json():
    # Measured: the compact instruction makes the transcript longer and breaks the
    # name anchors (22 noisy lines instead of 12); it belongs on the field stage only.
    assert reading.prompts.COMPACT_JSON not in reading.prompts.TRANSCRIBE_PROMPT


# --------------------------------------------------------------------------- prompt wiring in run()

def _tiny_image() -> bytes:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (64, 64), "white").save(buf, format="JPEG")
    return buf.getvalue()


def test_run_asks_for_compact_json_on_extraction_but_not_on_detection(monkeypatch):
    # Measured on the A4 scan: the compact instruction makes the detector return one
    # box instead of two (card + sefach) in every run; on the extraction stage it is
    # a pure token saving with identical values.
    monkeypatch.setattr(config, "BACKEND", "ollama")
    canned = {
        "RegionDetection": json.dumps({"regions": []}),
        "TranscribedLines": json.dumps({"lines": []}),
        "DocumentFields": json.dumps({
            "document_type": "teudat_zehut", "mrz_lines": None, "notes": None, "uncertain_fields": [],
            **{name: None for name in doctypes.FIELDS},
        }),
    }
    prompts = {}

    async def post(self, url, *args, json=None, **kwargs):
        title = json["format"]["title"]
        prompts[title] = json["messages"][-1]["content"]
        body = {"message": {"content": canned[title]}, "done_reason": "stop"}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    asyncio.run(pipeline.run(_tiny_image()))
    assert reading.prompts.COMPACT_JSON not in prompts["RegionDetection"]
    assert reading.prompts.COMPACT_JSON not in prompts["TranscribedLines"]
    assert prompts["DocumentFields"].endswith(reading.prompts.COMPACT_JSON)


def test_sefach_block_prompts_do_not_ask_for_compact_json(monkeypatch):
    # Measured on the real sheet: with the compact instruction the child block loses a
    # letter (ו) of the family name in every run; the saving there was 4 tokens.
    from PIL import Image, ImageDraw

    sheet = Image.new("RGB", (400, 800), "white")
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((300, 50, 380, 150), fill="black")  # holder cell (top right)
    draw.rectangle((300, 250, 380, 350), fill="black")  # first child cell
    prompts = []
    bodies = {
        "SefachHolderBlock": {"id_number": "1", "last_name_he": "a", "first_name_he": "b", "street": None, "house_number": None,
                              "entrance": None, "apartment": None, "city": None, "postal_code": None, "date_of_issue": None,
                              "confidence": "high"},
        "SefachChildBlock": {"holder_id_number": "1", "child": {"last_name_he": "a", "first_name_he": "c", "id_number": "2",
                                                                "date_of_birth": None, "sex": None, "confidence": "high"}},
    }

    async def post(self, url, *args, json=None, **kwargs):
        prompts.append(json["messages"][-1]["content"])
        content = globals()["json"].dumps(bodies[json["format"]["title"]])
        return httpx.Response(200, json={"message": {"content": content}, "done_reason": "stop"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    sefach = asyncio.run(reading.backend_ollama._extract_sefach_grid_ollama(sheet))
    assert sefach is not None and len(sefach.children) == 1
    assert len(prompts) == 2
    assert all(reading.prompts.COMPACT_JSON not in prompt for prompt in prompts)


# --------------------------------------------------------------------------- per-type extraction schemas

def test_ollama_json_sends_keep_alive_from_config(monkeypatch):
    post, calls = _fake_post([(GOOD, "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setattr(config, "OLLAMA_KEEP_ALIVE", "42m")
    asyncio.run(_ollama_json("img", None, "prompt", TranscribedLines, 64))
    assert calls[0]["keep_alive"] == "42m"


def test_schema_for_card_front_has_only_the_fields_the_card_carries():
    schema = reading.schemas_flat.extraction_schema_for("teudat_zehut")
    props = schema.model_json_schema()["properties"]
    assert set(props) == {"document_type", "notes", "uncertain_fields", *doctypes.CARRIED_FIELDS["teudat_zehut"]}
    # the full document_type vocabulary stays, so the model can still disagree with the detector
    assert "israeli_passport" in schema.model_fields["document_type"].annotation.__args__


def test_schema_for_a_type_uses_plain_values_and_lists_uncertain_fields_instead_of_per_field_confidence():
    # Per-field {value, confidence} wrappers cost ~9 tokens per field for the same values.
    props = reading.schemas_flat.extraction_schema_for("teudat_zehut").model_json_schema()["properties"]
    assert "$ref" not in props["last_name_he"]
    assert {o.get("type") for o in props["last_name_he"]["anyOf"]} == {"string", "null"}
    allowed = set(props["uncertain_fields"]["items"]["enum"])
    assert allowed == doctypes.CARRIED_FIELDS["teudat_zehut"]


def test_schema_for_card_back_keeps_mrz_lines():
    props = set(reading.schemas_flat.extraction_schema_for("teudat_zehut_back").model_json_schema()["properties"])
    assert "mrz_lines" in props
    assert "last_name_he" not in props


def test_schema_for_an_unknown_type_is_the_generic_flat_schema_and_the_passports_lacks_only_the_file_number():
    generic = reading.schemas_flat.extraction_schema_for(None)
    assert generic.__name__ == "DocumentFields"
    assert reading.schemas_flat.extraction_schema_for("other_document") is generic
    props = set(generic.model_json_schema()["properties"])
    assert props == {"document_type", "notes", "uncertain_fields", "mrz_lines", *doctypes.FIELDS}
    # The passport carries every identity field but the disability card's file number
    # (asked for it, the model put the passport's printed I.D. No. there) and the three
    # licence-only fields: license_number, address, categories.
    passport = reading.schemas_flat.extraction_schema_for("israeli_passport")
    excluded = {"file_number", "license_number", "address", "categories"}
    assert passport is not generic and set(passport.model_json_schema()["properties"]) == (
        props - excluded
    )


def test_schema_for_a_type_is_built_once():
    assert reading.schemas_flat.extraction_schema_for("teudat_zehut") is reading.schemas_flat.extraction_schema_for("teudat_zehut")


def test_to_document_extraction_fills_the_fields_the_slim_schema_left_out():
    schema = reading.schemas_flat.extraction_schema_for("teudat_zehut")
    slim = schema.model_validate({
        "document_type": "teudat_zehut", "notes": "glare", "uncertain_fields": ["date_of_expiry"],
        **{name: "x" for name in doctypes.CARRIED_FIELDS["teudat_zehut"]},
    })
    doc = reading.schemas_flat.to_document_extraction(slim)
    assert isinstance(doc, DocumentExtraction)
    assert doc.last_name_he.value == "x" and doc.last_name_he.confidence == "high"
    assert doc.date_of_expiry.value == "x" and doc.date_of_expiry.confidence == "medium"
    assert doc.last_name_en.value is None and doc.last_name_en.confidence == "high"
    assert doc.mrz_lines is None
    assert doc.notes == "glare"
    assert reading.schemas_flat.to_document_extraction(doc) is doc


def _fake_pipeline(monkeypatch, extraction_replies):
    """run() against canned Ollama bodies: one detected card-front region, then the
    extraction replies in order (each a (document_type, schema-title-check) pair)."""
    monkeypatch.setattr(config, "BACKEND", "ollama")
    requests = []

    def doc_body(schema_title, document_type):
        schema = reading.schemas_flat.extraction_schema_for(None if schema_title == "DocumentFields" else "teudat_zehut")
        names = [n for n in schema.model_fields if n not in ("document_type", "notes", "mrz_lines", "uncertain_fields")]
        body = {"document_type": document_type, "notes": None, "uncertain_fields": [], **{n: None for n in names}}
        if "mrz_lines" in schema.model_fields:
            body["mrz_lines"] = None
        return json.dumps(body)

    async def post(self, url, *args, json=None, **kwargs):
        title = json["format"]["title"]
        requests.append(title)
        if title == "RegionDetection":
            content = globals()["json"].dumps({"regions": [{"label": "id_card_front", "bbox_2d": [100, 100, 600, 600]}]})
        elif title == "TranscribedLines":
            content = globals()["json"].dumps({"lines": []})
        else:
            content = doc_body(title, extraction_replies.pop(0))
        return httpx.Response(200, json={"message": {"content": content}, "done_reason": "stop"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return requests


def test_run_uses_the_detected_types_schema_for_the_region(monkeypatch):
    requests = _fake_pipeline(monkeypatch, ["teudat_zehut"])
    result = asyncio.run(pipeline.run(_tiny_image()))
    assert result.extraction.document_type == "teudat_zehut"
    assert requests[-1] == reading.schemas_flat.extraction_schema_for("teudat_zehut").__name__
    assert "DocumentFields" not in requests


def test_run_falls_back_to_the_generic_schema_when_the_model_disagrees_with_the_detector(monkeypatch):
    requests = _fake_pipeline(monkeypatch, ["israeli_passport", "israeli_passport"])
    result = asyncio.run(pipeline.run(_tiny_image()))
    assert result.extraction.document_type == "israeli_passport"
    assert requests[-2:] == [reading.schemas_flat.extraction_schema_for("teudat_zehut").__name__, "DocumentFields"]


def test_ollama_usage_is_logged_as_token_counts_only(monkeypatch, caplog):
    async def post(self, url, *args, json=None, **kwargs):
        body = {
            "message": {"content": GOOD},
            "done_reason": "stop",
            "prompt_eval_count": 1234,
            "eval_count": 56,
            "total_duration": 2_500_000_000,
        }
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with caplog.at_level("INFO", logger="makor.usage"):
        asyncio.run(_ollama_json("IMAGEBYTES", "SYSTEMTEXT", "USERTEXT", TranscribedLines, 64))
    records = [r.getMessage() for r in caplog.records if r.name == "makor.usage"]
    assert len(records) == 1
    line = records[0]
    for part in ("backend=ollama", "schema=TranscribedLines", "input_tokens=1234", "output_tokens=56", "done_reason=stop", "total_s=2.5"):
        assert part in line
    for secret in ("IMAGEBYTES", "SYSTEMTEXT", "USERTEXT", "lines"):
        assert secret not in line


def test_ollama_call_usage_is_collected_when_a_collector_is_active(monkeypatch):
    async def post(self, url, *args, json=None, **kwargs):
        body = {"message": {"content": GOOD}, "done_reason": "stop", "prompt_eval_count": 1234, "eval_count": 56}
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    collected: list = []
    token = reading._usage_collector.set(collected)
    try:
        asyncio.run(_ollama_json("img", None, "prompt", TranscribedLines, 64))
    finally:
        reading._usage_collector.reset(token)
    assert len(collected) == 1
    assert (collected[0].backend, collected[0].schema, collected[0].input_tokens, collected[0].output_tokens) == (
        "ollama", "TranscribedLines", 1234, 56)


def _page_with_a_card() -> bytes:
    """A grey page with a saturated blue card on it: the local detector finds the card."""
    from io import BytesIO

    from PIL import Image, ImageDraw

    page = Image.new("RGB", (400, 560), (205, 205, 205))
    ImageDraw.Draw(page).rectangle((100, 60, 300, 186), fill=(70, 110, 190))
    buf = BytesIO()
    page.save(buf, format="JPEG")
    return buf.getvalue()


def test_run_skips_the_model_detector_when_the_local_one_finds_a_region(monkeypatch):
    requests = _fake_pipeline(monkeypatch, ["teudat_zehut"])
    result = asyncio.run(pipeline.run(_page_with_a_card()))
    assert "RegionDetection" not in requests
    assert len(result.regions) == 1
    x1, y1, x2, y2 = result.regions[0].bbox_2d
    assert abs(x1 - 250) <= 25 and abs(y1 - 107) <= 25 and abs(x2 - 750) <= 25 and abs(y2 - 332) <= 25  # JPEG chroma bleed
    assert result.regions[0].label == "document"  # no geometric label for a card: generic schema
    assert requests == ["TranscribedLines", "DocumentFields"]


def test_run_falls_back_to_the_model_detector_when_the_local_one_finds_nothing(monkeypatch):
    requests = _fake_pipeline(monkeypatch, ["teudat_zehut"])
    asyncio.run(pipeline.run(_tiny_image()))  # a blank white square: nothing to find locally
    assert requests[0] == "RegionDetection"


def _card_pipeline(monkeypatch, transcript_lines: list[str], sex=None, place_of_birth=None, typed_place_of_birth="same", **values):
    """run() on a page with one blue card; the transcript and the card's sex / place of
    birth answers are canned (`typed_place_of_birth` is what the card-typed schema answers)."""
    monkeypatch.setattr(config, "BACKEND", "ollama")
    fields = {name: None for name in doctypes.FIELDS}
    fields.update(dict(id_number="123456782", last_name_he="כהן", first_name_he="דנה", sex=sex, place_of_birth=place_of_birth) | values)
    if typed_place_of_birth == "same":
        typed_place_of_birth = place_of_birth
    calls: list[str] = []

    async def post(self, url, *args, json=None, **kwargs):
        title = json["format"]["title"]
        calls.append(title)
        if title == "TranscribedLines":
            content = globals()["json"].dumps({"lines": transcript_lines}, ensure_ascii=False)
        else:
            schema = reading.schemas_flat.extraction_schema_for(None if title == "DocumentFields" else "teudat_zehut")
            names = [n for n in schema.model_fields if n not in ("document_type", "notes", "mrz_lines", "uncertain_fields")]
            answer = dict(fields, place_of_birth=typed_place_of_birth) if title == "TeudatZehutFields" else fields
            body = {"document_type": "teudat_zehut", "notes": None, "uncertain_fields": [], **{n: answer[n] for n in names}}
            if "mrz_lines" in schema.model_fields:
                body["mrz_lines"] = None
            content = globals()["json"].dumps(body, ensure_ascii=False)
        return httpx.Response(200, json={"message": {"content": content}, "done_reason": "stop"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return calls


def test_run_takes_the_old_cards_sex_from_the_transcript_and_keeps_its_place_of_birth(monkeypatch):
    _card_pipeline(monkeypatch, ["תעודת זהות", "שם המשפחה", "כהן", "מקום הלידה", "ישראל", "زكر", "המין"], place_of_birth="ישראל")
    result = asyncio.run(pipeline.run(_page_with_a_card()))
    assert (result.extraction.sex.value, result.extraction.sex.confidence) == ("M", "high")
    assert result.extraction.place_of_birth.value == "ישראל"


def test_run_drops_sex_and_place_of_birth_the_biometric_card_does_not_print(monkeypatch):
    _card_pipeline(monkeypatch, ["תעודת זהות", "שם המשפחה", "כהן"], sex="M", place_of_birth="חיפה")
    result = asyncio.run(pipeline.run(_page_with_a_card()))
    assert result.extraction.sex.value is None and result.extraction.place_of_birth.value is None


def test_run_rereads_with_the_card_schema_when_a_printed_field_came_back_empty(monkeypatch):
    # Measured on the old laminated card: the generic schema leaves place_of_birth null
    # 3/3 while the card-typed schema reads it 3/3. The transcript shows the label, so the
    # empty answer is the schema's fault, not the document's — one targeted re-read.
    calls = _card_pipeline(monkeypatch, ["מקום הלידה", "ישראל", "זכר", "המין"], place_of_birth=None, typed_place_of_birth="ישראל")
    result = asyncio.run(pipeline.run(_page_with_a_card()))
    assert result.extraction.place_of_birth.value == "ישראל"
    assert calls.count("DocumentFields") == 1 and calls.count("TeudatZehutFields") == 1


def test_run_does_not_reread_when_no_printed_field_is_missing(monkeypatch):
    calls = _card_pipeline(monkeypatch, ["מקום הלידה", "ישראל"], place_of_birth="ישראל")
    asyncio.run(pipeline.run(_page_with_a_card()))
    assert "TeudatZehutFields" not in calls


def test_run_keeps_the_old_cards_parents_names_when_their_labels_are_printed(monkeypatch):
    _card_pipeline(monkeypatch, ["שם המשפחה", "כהן", "שם האב", "שם האם"], father_name_he="יוסף", mother_name_he="רחל")
    result = asyncio.run(pipeline.run(_page_with_a_card()))
    assert (result.extraction.father_name_he.value, result.extraction.mother_name_he.value) == ("יוסף", "רחל")


def test_run_drops_parents_names_the_biometric_card_does_not_print(monkeypatch):
    _card_pipeline(monkeypatch, ["שם המשפחה", "כהן"], father_name_he="יוסף", mother_name_he="רחל")
    result = asyncio.run(pipeline.run(_page_with_a_card()))
    assert result.extraction.father_name_he.value is None and result.extraction.mother_name_he.value is None


def test_schema_for_foreign_passport_has_the_mrz_and_latin_names_but_no_hebrew_names():
    props = set(reading.schemas_flat.extraction_schema_for("foreign_passport").model_json_schema()["properties"])
    assert {"mrz_lines", "last_name_en", "nationality", "passport_number"} <= props
    assert "last_name_he" not in props and "id_number" not in props


def test_run_takes_the_old_cards_parents_from_the_transcript_over_the_model(monkeypatch):
    from tests.test_extraction import OLD_CARD_LINES

    # the model shifts the parents by one line; the transcript anchors win
    _card_pipeline(monkeypatch, OLD_CARD_LINES, father_name_he="רחל", mother_name_he="זקר")
    result = asyncio.run(pipeline.run(_page_with_a_card()))
    assert (result.extraction.father_name_he.value, result.extraction.mother_name_he.value) == ("יוסף", "רחל")
    assert result.extraction.father_name_he.confidence == "medium"  # the model had a different value


def test_run_pins_the_id_number_from_the_transcript(monkeypatch):
    # the model swaps the flanking digits of the spaced ID; the transcript line is right
    _card_pipeline(monkeypatch, ["שם המשפחה", "כהן", "1 2345678 2"], id_number="23456781")
    result = asyncio.run(pipeline.run(_page_with_a_card()))
    assert (result.extraction.id_number.value, result.extraction.id_number.confidence) == ("123456782", "medium")


def test_ollama_json_model_override_reaches_the_payload_and_the_usage_log(monkeypatch, caplog):
    post, calls = _fake_post([(GOOD, "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with caplog.at_level("INFO", logger="makor.usage"):
        asyncio.run(_ollama_json("img", None, "prompt", TranscribedLines, 64, model="qwen3-vl:2b-instruct"))
    assert calls[0]["model"] == "qwen3-vl:2b-instruct"
    assert "model=qwen3-vl:2b-instruct schema=TranscribedLines" in caplog.text


def test_ollama_json_without_override_uses_the_request_model(monkeypatch):
    post, calls = _fake_post([(GOOD, "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    asyncio.run(_ollama_json("img", None, "prompt", TranscribedLines, 64))
    assert calls[0]["model"] == reading.current_options().model


# --------------------------------------------------------------------------- per-type hints

def test_the_shared_system_prompt_names_no_disability_card():
    # A layout added to SYSTEM_PROMPT for the disability card moved the Nepali passport's
    # issue date into the expiry field on the 8B model, 3/3 runs (2026-09-10): the shared
    # contract stays byte-stable and a type's layout travels only with that type's read.
    assert "disability" not in reading.prompts.SYSTEM_PROMPT.lower()
    assert "מס' תיק" in reading.prompts.DISABILITY_CARD_HINT


DISABILITY_ANSWER = json.dumps({"document_type": "disability_card", "notes": None, "uncertain_fields": [],
                                "last_name_he": "כהן", "first_name_he": "דנה", "last_name_en": "COHEN",
                                "first_name_en": "DANA", "id_number": "123456782", "file_number": "123400001",
                                "date_of_expiry": "03.2014"}, ensure_ascii=False)


def test_a_disability_card_read_carries_its_layout_hint_in_the_user_prompt_only(monkeypatch):
    call, calls = _fake_call([DISABILITY_ANSWER])
    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", call)
    doc = asyncio.run(reading.backend_ollama._extract_fields_ollama("IMG", "1. line", {}, "disability_card"))
    assert doc.document_type == "disability_card" and doc.file_number.value == "123400001"
    messages = calls[0]["messages"]
    assert messages[0]["content"] == reading.prompts.SYSTEM_PROMPT
    assert reading.prompts.DISABILITY_CARD_HINT in messages[-1]["content"]
    assert messages[-1]["content"].endswith(reading.prompts.COMPACT_JSON)


def test_a_card_front_read_carries_no_layout_hint(monkeypatch):
    card = json.dumps({"document_type": "teudat_zehut", "notes": None, "uncertain_fields": [], "last_name_he": "כהן",
                       "first_name_he": "דנה", "id_number": "123456782", "date_of_birth": None, "date_of_issue": None,
                       "date_of_expiry": None, "sex": None, "place_of_birth": None, "father_name_he": None,
                       "mother_name_he": None}, ensure_ascii=False)
    call, calls = _fake_call([card])
    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", call)
    asyncio.run(reading.backend_ollama._extract_fields_ollama("IMG", "1. line", {}, "teudat_zehut"))
    assert reading.prompts.DISABILITY_CARD_HINT not in calls[0]["messages"][-1]["content"]


# ----------------------------------------------------------------- the printed title anchor

def test_stage_b_switches_to_the_disability_schema_on_the_title_anchor(monkeypatch):
    disability = extraction_schema_for("disability_card")
    blank = {f: None for f in disability.model_fields if f not in ("document_type", "uncertain_fields")}
    answer = json.dumps({"document_type": "disability_card", **blank, "uncertain_fields": []})
    post, calls = _fake_post([(answer, "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    doc = asyncio.run(_extract_fields_ollama("img", "1. תעודת נכה", {"_type": "disability_card"}, expected_type="teudat_zehut"))
    assert doc.document_type == "disability_card"
    assert calls[0]["format"]["title"] == disability.model_json_schema()["title"]
    assert "file_number" in calls[0]["format"]["properties"]


def test_stage_b_keeps_the_anchored_type_when_the_model_mislabels_itself(monkeypatch):
    # The 30B model, read with the disability schema on the disabled-veteran card, fills
    # every field (file_number, the Latin names, the MM.YYYY expiry) correctly but still
    # writes "teudat_zehut" into its own document_type field (2026-09-11, measured). The
    # printed title is stronger evidence than that self-report: it must not trigger the
    # generic-schema redirect meant for an actually wrong detector/classifier guess —
    # but only once the read is backed by file_number, evidence exclusive to this type
    # (a synthetic value here; no real one ever enters the repo).
    disability = extraction_schema_for("disability_card")
    blank = {f: None for f in disability.model_fields if f not in ("document_type", "uncertain_fields")}
    blank["file_number"] = "1234567"
    answer = json.dumps({"document_type": "teudat_zehut", **blank, "uncertain_fields": []})
    post, calls = _fake_post([(answer, "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    doc = asyncio.run(_extract_fields_ollama("img", "1. תעודת נכה", {"_type": "disability_card"}, expected_type="teudat_zehut"))
    assert doc.document_type == "disability_card"
    assert len(calls) == 1  # no second call spent on a self-report the anchor outranks


def _blank_answer(schema, document_type, **fields):
    blank = {f: None for f in schema.model_fields if f not in ("document_type", "uncertain_fields")}
    return json.dumps({"document_type": document_type, **blank, **fields, "uncertain_fields": []})


def test_stage_b_rereads_without_the_anchor_when_the_gate_rejects_it(monkeypatch):
    # A rejected anchor must cost nothing but one call: the read is redone exactly as if
    # no anchor had fired, on the detector's/classifier's own expected type, so the typed
    # path's machinery (its own generic re-read, the gated-field recovery, the MRZ retype)
    # is back in force. Landing straight in the generic re-read instead would silently
    # drop the gated fields (place_of_birth and the parents on an old laminated card).
    disability = extraction_schema_for("disability_card")
    card = extraction_schema_for("teudat_zehut")
    post, calls = _fake_post([(_blank_answer(disability, "teudat_zehut"), "stop"),
                              (_blank_answer(card, "teudat_zehut", first_name_he="דנה"), "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    doc = asyncio.run(_extract_fields_ollama("img", "1. תעודת זהות", {"_type": "disability_card"}, expected_type="teudat_zehut"))
    assert doc.document_type == "teudat_zehut"
    assert len(calls) == 2
    assert calls[0]["format"]["title"] == disability.model_json_schema()["title"]
    assert calls[1]["format"]["title"] == card.model_json_schema()["title"]
    assert doc.first_name_he is not None and doc.first_name_he.value == "דנה"


def test_stage_b_redone_read_keeps_the_generic_fall_through_of_the_unanchored_path(monkeypatch):
    # The title anchor can itself be a false positive (a corrupted ID-card title scoring
    # above the match threshold, anchors.py's competing-title guard notwithstanding —
    # this test exercises the second, independent guard). Without file_number the model's
    # own self-report must win; the read is redone un-anchored, and when THAT typed read
    # also disagrees the pre-anchor generic re-read still happens: three calls, the final
    # type is the model's.
    disability = extraction_schema_for("disability_card")
    card = extraction_schema_for("teudat_zehut")
    generic = extraction_schema_for(None)
    post, calls = _fake_post([(_blank_answer(disability, "teudat_zehut"), "stop"),
                              (_blank_answer(card, "israeli_passport"), "stop"),
                              (_blank_answer(generic, "israeli_passport"), "stop")])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    doc = asyncio.run(_extract_fields_ollama("img", "1. תעודת זהות", {"_type": "disability_card"}, expected_type="teudat_zehut"))
    assert doc.document_type == "israeli_passport"
    assert len(calls) == 3
    assert calls[1]["format"]["title"] == card.model_json_schema()["title"]
    assert calls[2]["format"]["title"] == generic.model_json_schema()["title"]


def test_encode_floor_reaches_every_ollama_encode(monkeypatch):
    """A frame normalised by dpi is sent at its own size: no call may re-apply the
    1024 px floor. Captured through the reading layer's encode_jpeg min_dim."""
    from app.reading import backend_ollama
    seen: list[int] = []
    real = backend_ollama.encode_jpeg

    def spy(image, max_dim, min_dim=0):
        seen.append(min_dim)
        return real(image, max_dim, min_dim)

    monkeypatch.setattr(backend_ollama, "encode_jpeg", spy)
    sheet = Image.new("RGB", (400, 600), "white")  # blank: every cell is skipped, nothing is sent
    asyncio.run(backend_ollama._extract_sefach_grid_ollama(sheet, floor=0))
    cell = Image.new("RGB", (200, 100), "white")
    backend_ollama._cell_b64(cell, floor=0)
    backend_ollama._cell_b64(cell)
    assert seen[-2:] == [0, backend_ollama.CROP_MIN_DIM]


# --------------------------------------------------------------------------- the passport type from the MRZ
from tests.test_extraction import _TD3_ISR, _TD3_UTO  # noqa: E402


def _passport_pipeline(monkeypatch, answers: dict[str, tuple[str, list[str] | None, str | None]]):
    """run() against canned Ollama bodies: one detected region labelled as a card, and a
    field answer per schema title as (document_type, mrz_lines, last_name_he)."""
    monkeypatch.setattr(config, "BACKEND", "ollama")
    monkeypatch.setattr(config, "CLASSIFY", False)
    requests = []

    async def post(self, url, *args, json=None, **kwargs):
        title = json["format"]["title"]
        requests.append(title)
        if title == "RegionDetection":
            content = globals()["json"].dumps({"regions": [{"label": "id_card_front", "bbox_2d": [100, 100, 600, 600]}]})
        elif title == "TranscribedLines":
            content = globals()["json"].dumps({"lines": []})
        else:
            doc_type, mrz, last_name = answers[title]
            typed = {"TeudatZehutFields": "teudat_zehut", "IsraeliPassportFields": "israeli_passport",
                     "ForeignPassportFields": "foreign_passport"}
            schema = reading.schemas_flat.extraction_schema_for(typed.get(title))
            names = [n for n in schema.model_fields if n not in ("document_type", "notes", "mrz_lines", "uncertain_fields")]
            body = {"document_type": doc_type, "notes": None, "uncertain_fields": [], **{n: None for n in names}}
            if "mrz_lines" in schema.model_fields:
                body["mrz_lines"] = mrz
            if "last_name_he" in schema.model_fields:
                body["last_name_he"] = last_name
            content = globals()["json"].dumps(body, ensure_ascii=False)
        return httpx.Response(200, json={"message": {"content": content}, "done_reason": "stop"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return requests


def test_run_rereads_an_israeli_passport_the_model_called_foreign_when_the_mrz_says_isr(monkeypatch):
    # Measured 2026-09-10: an old non-biometric darkon read as foreign_passport 2/2 with
    # nationality ISRAEL and an MRZ starting P<ISR — and its Hebrew names and ID nulled
    # as fields a foreign passport does not carry. The issuing state decides the type.
    requests = _passport_pipeline(monkeypatch, {
        "TeudatZehutFields": ("foreign_passport", None, None),
        "DocumentFields": ("foreign_passport", _TD3_ISR, "כהן"),
        "IsraeliPassportFields": ("israeli_passport", _TD3_ISR, "כהן"),
    })
    result = asyncio.run(pipeline.run(_tiny_image()))
    assert requests[-2:] == ["DocumentFields", "IsraeliPassportFields"]
    assert result.extraction.document_type == "israeli_passport"
    assert result.extraction.last_name_he.value == "כהן"


def test_run_retypes_to_the_mrz_state_when_the_typed_reread_still_disagrees(monkeypatch):
    requests = _passport_pipeline(monkeypatch, {
        "TeudatZehutFields": ("foreign_passport", None, None),
        "DocumentFields": ("foreign_passport", _TD3_ISR, "כהן"),
        "IsraeliPassportFields": ("foreign_passport", _TD3_ISR, None),
    })
    result = asyncio.run(pipeline.run(_tiny_image()))
    assert requests.count("IsraeliPassportFields") == 1
    assert result.extraction.document_type == "israeli_passport"
    assert result.extraction.last_name_he.value == "כהן"  # the generic read's fields survive


def test_run_rereads_a_foreign_passport_the_model_called_israeli_when_the_mrz_state_is_not_isr(monkeypatch):
    requests = _passport_pipeline(monkeypatch, {
        "TeudatZehutFields": ("israeli_passport", None, None),
        "DocumentFields": ("israeli_passport", _TD3_UTO, None),
        "ForeignPassportFields": ("foreign_passport", _TD3_UTO, None),
    })
    result = asyncio.run(pipeline.run(_tiny_image()))
    assert requests[-1] == "ForeignPassportFields"
    assert result.extraction.document_type == "foreign_passport"


def test_run_leaves_a_passport_alone_when_the_mrz_agrees_or_is_missing(monkeypatch):
    requests = _passport_pipeline(monkeypatch, {
        "TeudatZehutFields": ("foreign_passport", None, None),
        "DocumentFields": ("foreign_passport", _TD3_UTO, None),
    })
    result = asyncio.run(pipeline.run(_tiny_image()))
    assert result.extraction.document_type == "foreign_passport" and requests[-1] == "DocumentFields"
    requests = _passport_pipeline(monkeypatch, {
        "TeudatZehutFields": ("foreign_passport", None, None),
        "DocumentFields": ("foreign_passport", None, None),
    })
    result = asyncio.run(pipeline.run(_tiny_image()))
    assert result.extraction.document_type == "foreign_passport" and requests[-1] == "DocumentFields"


# --------------------------------------------------------------------------- installed_models

def _fake_get(status: int, body: dict | None = None, error: Exception | None = None):
    async def get(self, url, *args, **kwargs):
        if error:
            raise error
        return httpx.Response(status, json=body or {}, request=httpx.Request("GET", url))
    return get


def test_installed_models_lists_the_pulled_tags(monkeypatch):
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get(200, {"models": [{"name": "qwen3-vl:8b-instruct"}, {"name": "qwen3-vl:8b"}]}))
    assert asyncio.run(installed_models()) == ["qwen3-vl:8b-instruct", "qwen3-vl:8b"]


def test_installed_models_is_none_when_ollama_is_down(monkeypatch):
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get(0, error=httpx.ConnectError("refused")))
    assert asyncio.run(installed_models()) is None
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get(500))
    assert asyncio.run(installed_models()) is None


@pytest.mark.parametrize("body", [
    ["qwen3-vl:8b-instruct"],        # a bare array: valid JSON, wrong shape
    "qwen3-vl:8b-instruct",          # a bare string
    {"models": "qwen3-vl:8b"},       # the key is there but is not a list
    {"models": ["qwen3-vl:8b"]},     # a list of strings rather than of objects
])
def test_installed_models_is_none_on_a_200_of_the_wrong_shape(monkeypatch, body):
    """The contract is a list of tags or None — "None" covering everything that went wrong,
    so a settings page never reads a shape error as "nothing is installed". Ollama always
    answers with an object, but the caller must not depend on that."""
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get(200, body))
    assert asyncio.run(installed_models()) is None


def test_installed_models_is_none_on_a_malformed_200_body(monkeypatch):
    async def get(self, url, *args, **kwargs):
        return httpx.Response(200, content=b"not json", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    assert asyncio.run(installed_models()) is None
