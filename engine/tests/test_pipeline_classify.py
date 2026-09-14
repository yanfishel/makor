"""pipeline._run with the classifier on: what is read, what is skipped, what comes back
when nothing on the page is a document. Ollama HTTP faked by schema title."""

import asyncio
import io
import json

import httpx
import pytest
from PIL import Image, ImageDraw

from app import config, pipeline
from app.doctypes import FIELDS, IDENTITY_TYPES
from app.errors import ExtractionError
from app.reading.schemas_flat import _TYPE_PHRASE, extraction_schema_for
from app.regions import detect_regions_local
from tests.test_sefach_guard import _fake_ollama as _fake_sefach_ollama
from tests.test_sefach_guard import _holder_json, _page_with_card_and_sefach

CARD_ID = "123456782"

# A blank page yields no local region, so the Ollama path asks the model detector before
# any frame exists to classify: every blank-page call sequence below starts with it.
DETECT = "RegionDetection"


def _blank_page() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (850, 1170), (250, 250, 250)).save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _kind_json(kind) -> str:
    """`kind` is a kind name (sure) or a (kind, sure) tuple."""
    kind, sure = kind if isinstance(kind, tuple) else (kind, True)
    return json.dumps({"kind": kind, "sure": sure})


def _ruled_cheque(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int]) -> None:
    """Grey-scale cheque: a light body with ruled lines and a MICR line at the bottom
    (copied from tests/test_regions.py — the smallest fixture the local detector splits
    into exactly `cheque_front` + `cheque_back`)."""
    x1, y1, x2, y2 = box
    draw.rectangle(box, fill=245)
    for y in range(y1 + 30, y2 - 40, 20):
        draw.line((x1 + 30, y, x2 - 30, y), fill=20, width=2)
    for x in range(x1 + 30, x2 - 30, 12):  # MICR digits
        draw.rectangle((x, y2 - 25, x + 8, y2 - 12), fill=0)


def _cheque_front_and_back_page() -> bytes:
    page = Image.new("L", (608, 566), 235)
    draw = ImageDraw.Draw(page)
    _ruled_cheque(draw, (0, 0, 607, 280))
    # the guarantee stamp on the back, rotated, in the lower-left corner
    draw.rectangle((60, 320, 150, 540), outline=0, width=3)
    draw.line((80, 340, 130, 520), fill=0, width=2)
    buf = io.BytesIO()
    page.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


CHEQUE_FRONT = {"document_type": "cheque", "bank_name": "דיסקונט", "bank_code": "11", "branch_number": "148",
                "account_number": "0000123456", "cheque_number": "80001234", "drawer_name": "ישראל ישראלי",
                "drawer_id_number": "123456782", "drawer_address": None, "drawer_phone": None, "payee": "יעל לוי",
                "amount": "4,500.—", "amount_in_words": 'ארבעת אלפים וחמש מאות ש"ח', "date": "6.4.25",
                "payee_only": True, "signed": True, "micr_line": "80001234 11 14841 0000123456",
                "uncertain_fields": ["payee"], "notes": None}
CHEQUE_BACK = {"document_type": "cheque_back", "guarantor_name": "אבי", "guarantor_id_number": "123456782",
               "guarantor_signed": True, "uncertain_fields": [], "notes": None}


def _other_fields_json() -> str:
    """A reading answer that types the frame `other` — the reader's vocabulary has no
    senior-citizen/disability/weapon type, so that is what it says for one."""
    return json.dumps({"document_type": "other", "mrz_lines": None, "notes": None, "uncertain_fields": [],
                       **{name: None for name in FIELDS}})


def _fake_ollama(monkeypatch, kinds: list[str], *, fail_classifier=False, fail_schemas: tuple[str, ...] = (),
                 transcript: list[str] | None = None):
    """Canned Ollama: FrameClass answers come from `kinds` in call order; the reading
    schemas get a fixed card/sefach answer. Schema titles in `fail_schemas` answer 500,
    which is an ExtractionError. Returns the list of schema titles called."""
    monkeypatch.setattr(config, "BACKEND", "ollama")
    monkeypatch.setattr(config, "CLASSIFY", True)
    calls: list[str] = []
    card_fields = {name: None for name in FIELDS}
    card_fields.update(id_number=CARD_ID, last_name_he="כהן", first_name_he="דנה")
    canned = {
        "RegionDetection": json.dumps({"regions": []}),
        "TranscribedLines": json.dumps({"lines": transcript or []}, ensure_ascii=False),
        "DocumentFields": json.dumps({"document_type": "teudat_zehut", "mrz_lines": None, "notes": None,
                                      "uncertain_fields": [], **card_fields}, ensure_ascii=False),
        "SefachHolderBlock": _holder_json(CARD_ID, "דנה", "הרצל"),
        # A sure classifier kind asks for the type's own flat schema; answer it with the
        # same synthetic card, typed as asked so the call is not repeated generically.
        **{extraction_schema_for(t).__name__: json.dumps({"document_type": t, "mrz_lines": None, "notes": None,
                                                         "uncertain_fields": [], **card_fields}, ensure_ascii=False)
           for t in _TYPE_PHRASE},
        "DisabilityCardFields": json.dumps({"document_type": "disability_card", "notes": None, "uncertain_fields": [],
                                            "last_name_he": "כהן", "first_name_he": "דנה", "last_name_en": "COHEN",
                                            "first_name_en": "DANA", "id_number": CARD_ID, "file_number": "123400001",
                                            "date_of_expiry": "03.2014"}, ensure_ascii=False),
        "ChequeFields": json.dumps(CHEQUE_FRONT, ensure_ascii=False),
        "ChequeBackFields": json.dumps(CHEQUE_BACK, ensure_ascii=False),
        "ChequeDrawerBlock": json.dumps({"drawer_name": None, "drawer_id_number": None, "drawer_address": None,
                                         "drawer_phone": None, "uncertain_fields": []}),
    }
    replies = list(kinds)

    async def post(self, url, *args, json=None, **kwargs):
        title = json["format"]["title"]
        calls.append(title)
        if title in fail_schemas:
            return httpx.Response(500, text="boom", request=httpx.Request("POST", url))
        if title == "FrameClass":
            if fail_classifier:
                return httpx.Response(500, text="boom", request=httpx.Request("POST", url))
            content = _kind_json(replies.pop(0))
        else:
            content = canned[title]
        return httpx.Response(200, json={"message": {"content": content}, "done_reason": "stop"},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return calls


def _reader_answers_other(monkeypatch):
    """Layer an `other` answer for the field-extraction call on top of the canned fake."""
    original = httpx.AsyncClient.post
    other = _other_fields_json()

    async def post(self, url, *args, json=None, **kwargs):
        if json["format"]["title"].endswith("Fields") and "Cheque" not in json["format"]["title"]:
            await original(self, url, *args, json=json, **kwargs)  # keep the call recorded
            return httpx.Response(200, json={"message": {"content": other}, "done_reason": "stop"},
                                  request=httpx.Request("POST", url))
        return await original(self, url, *args, json=json, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", post)


def test_card_and_sefach_are_both_read_when_the_card_is_identity(monkeypatch):
    # detector: card (unlabelled) + sefach (labelled, no classifier call for it)
    calls = _fake_ollama(monkeypatch, ["teudat_zehut"])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert calls.count("FrameClass") == 1
    assert result.extraction is not None and result.extraction.id_number.value == CARD_ID
    assert result.sefach is not None
    assert [r.document_type for r in result.regions] == ["teudat_zehut", "teudat_zehut_sefach"]
    assert not any("more document(s) on the page were not read" in w for w in result.warnings)


def test_a_none_region_next_to_a_card_is_skipped_not_read(monkeypatch):
    # the same page, but the classifier calls the card frame "none" and the detector's
    # sefach still reads: the page has an identity document, the "none" frame is skipped
    calls = _fake_ollama(monkeypatch, ["none"])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert [r.document_type for r in result.regions][0] == "skipped"
    assert "DocumentFields" not in calls  # the skipped frame's fields were never read
    assert any(w == "1 more document(s) on the page were not read" for w in result.warnings)


def test_a_page_of_none_reads_nothing_and_returns_an_empty_result(monkeypatch):
    calls = _fake_ollama(monkeypatch, ["none"])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert calls == [DETECT, "FrameClass"]  # classified, then nothing read
    assert result.extraction is None and result.cheque is None and result.sefach is None
    assert [r.document_type for r in result.regions] == ["skipped"]
    assert result.regions[0].bbox_2d == [0, 0, 1000, 1000]
    assert result.classified_type is None
    assert not any("more document(s) on the page were not read" in w for w in result.warnings)


def test_a_classifier_failure_fails_the_request_without_reading(monkeypatch):
    calls = _fake_ollama(monkeypatch, [], fail_classifier=True)
    with pytest.raises(ExtractionError):
        asyncio.run(pipeline.run(_blank_page()))
    assert calls == [DETECT, "FrameClass"]  # a 5xx is an ExtractionError, not a truncation: no retry, no read


def test_classifier_off_reads_every_frame_without_a_frameclass_call(monkeypatch):
    calls = _fake_ollama(monkeypatch, [])
    monkeypatch.setattr(config, "CLASSIFY", False)
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert "FrameClass" not in calls
    assert result.extraction is not None and result.sefach is not None
    assert all(r.document_type != "skipped" for r in result.regions)


def test_unsupported_kind_read_as_other_carries_the_classifier_label(monkeypatch):
    calls = _fake_ollama(monkeypatch, ["senior_citizen_card"])
    _reader_answers_other(monkeypatch)  # the reader answers "other" for this frame
    result = asyncio.run(pipeline.run(_blank_page()))
    assert result.extraction is not None and result.extraction.document_type == "other"
    assert result.classified_type == "senior_citizen_card"
    assert calls.index("FrameClass") < calls.index("DocumentFields")  # classified before anything was read


def test_a_sure_unsupported_kind_read_as_an_identity_type_still_carries_the_classifier_label(monkeypatch):
    # The disabled-veteran card scan (2026-09-10): the classifier said disability_card, sure;
    # the reader, on the generic schema, answered teudat_zehut with the card's name and ID,
    # and the page went out as an identity card. The reader's vocabulary has no such kind,
    # so a sure classifier decides the type; the fields stay as read.
    calls = _fake_ollama(monkeypatch, ["senior_citizen_card"])
    result = asyncio.run(pipeline.run(_blank_page()))
    # (the canned generic answer is an identity type; which one depends on the fixture)
    assert result.extraction is not None and result.extraction.document_type in IDENTITY_TYPES
    assert result.extraction.id_number.value == CARD_ID  # the values read are kept
    assert result.classified_type == "senior_citizen_card"
    assert calls.count("DocumentFields") == 1


def test_a_sure_disability_card_is_read_with_its_own_schema(monkeypatch):
    calls = _fake_ollama(monkeypatch, ["disability_card"])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert "DisabilityCardFields" in calls and "DocumentFields" not in calls
    assert result.extraction is not None and result.extraction.document_type == "disability_card"
    assert result.extraction.file_number.value == "123400001"
    assert result.classified_type is None  # a supported type now: no "not tuned" warning


def test_a_supported_kind_read_as_other_carries_no_label(monkeypatch):
    calls = _fake_ollama(monkeypatch, ["teudat_zehut"])
    _reader_answers_other(monkeypatch)
    result = asyncio.run(pipeline.run(_blank_page()))
    assert result.classified_type is None
    assert calls.index("FrameClass") < calls.index("TeudatZehutFields")  # a sure kind asks the typed schema


def test_a_detector_labelled_back_is_not_classified_when_the_front_is_confirmed(monkeypatch):
    page = _cheque_front_and_back_page()
    assert [r.label for r in detect_regions_local(Image.open(io.BytesIO(page)))] == ["cheque_front", "cheque_back"]
    calls = _fake_ollama(monkeypatch, ["cheque_front"])  # one FrameClass answer: the front
    result = asyncio.run(pipeline.run(page))
    assert calls.count("FrameClass") == 1
    assert [r.document_type for r in result.regions] == ["cheque", "cheque_back"]
    assert not any("more document(s) on the page were not read" in w for w in result.warnings)


def test_a_detector_labelled_back_is_classified_when_the_front_is_rejected(monkeypatch):
    page = _cheque_front_and_back_page()
    calls = _fake_ollama(monkeypatch, ["none", "none"])  # front rejected, then the back is asked
    result = asyncio.run(pipeline.run(page))
    assert calls.count("FrameClass") == 2
    assert result.extraction is None and result.cheque is None
    assert [r.document_type for r in result.regions] == ["skipped", "skipped"]


def test_a_skipped_frame_does_not_count_as_a_failed_one(monkeypatch):
    # Spec §3: the whole-page fallback fires when every frame that was READ failed. The
    # card frame here is classified "none" and skipped, the sefach frame is read and its
    # block call fails — one failure out of one read frame, so the page is read whole.
    calls = _fake_ollama(monkeypatch, ["none"], fail_schemas=("SefachHolderBlock", "SefachOldTopBlock"))
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert [r.document_type for r in result.regions] == ["skipped", "unreadable"]
    assert any(w == "No region could be read on its own; the whole page was read instead" for w in result.warnings)
    # the fallback frame is unlabelled (two regions), so it takes the generic reading path
    assert calls.count("TranscribedLines") == 1 and calls.count("DocumentFields") == 1
    assert result.extraction is not None and result.extraction.id_number.value == CARD_ID


# ------------------------------------------------- geometry pre-gate and page-first
from app.regions import LocalRegion  # noqa: E402


def _regions(monkeypatch, boxes: list[tuple[str | None, list[int]]]) -> None:
    """Replace the local detector with fixed boxes (0-1000 units on the 850x1170 page)."""
    monkeypatch.setattr(pipeline, "detect_regions_local", lambda image: [LocalRegion(label, box) for label, box in boxes])


def test_several_junk_boxes_reject_the_page_without_a_call(monkeypatch):
    _regions(monkeypatch, [
        ("cheque_front", [0, 0, 1000, 60]),   # 850 x 70 px strip, aspect 12
        (None, [100, 100, 900, 900]),         # 680 x 936 px: the one real candidate
        (None, [500, 500, 540, 560]),         # 34 x 70 px scrap
        (None, [150, 150, 600, 600]),         # fully inside the candidate
    ])
    calls = _fake_ollama(monkeypatch, [])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert calls == []  # several junk boxes: the page is rejected before any model call
    assert result.extraction is None and result.cheque is None
    assert [r.document_type for r in result.regions] == ["skipped"] * 4
    assert [r.bbox_2d for r in result.regions][0] == [0, 0, 1000, 60]  # detector order kept
    assert any(w.startswith("Page rejected on geometry: 3 of 4") for w in result.warnings)


def test_a_single_sliver_inside_a_document_is_skipped_and_the_document_goes_on(monkeypatch):
    _regions(monkeypatch, [(None, [100, 100, 900, 900]), (None, [150, 150, 600, 600])])
    calls = _fake_ollama(monkeypatch, ["teudat_zehut"])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert calls.count("FrameClass") == 1
    assert [r.document_type for r in result.regions] == ["teudat_zehut", "skipped"]
    assert result.extraction is not None
    assert any(w == "1 more document(s) on the page were not read" for w in result.warnings)


def test_a_single_junk_box_beside_a_document_is_skipped_and_the_document_goes_on(monkeypatch):
    _regions(monkeypatch, [(None, [100, 100, 900, 700]), ("cheque_front", [0, 900, 1000, 950])])  # a strip below
    calls = _fake_ollama(monkeypatch, ["foreign_passport"])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert calls.count("FrameClass") == 1  # the strip never reaches the classifier
    assert [r.document_type for r in result.regions][1] == "skipped"
    assert result.extraction is not None


def test_three_candidates_classify_the_page_first_and_stop_on_none(monkeypatch):
    _regions(monkeypatch, [(None, [50, 50, 450, 450]), (None, [550, 50, 950, 450]), (None, [50, 550, 450, 950])])
    calls = _fake_ollama(monkeypatch, ["none"])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert calls.count("FrameClass") == 1
    assert result.extraction is None
    assert [r.document_type for r in result.regions] == ["skipped"] * 3
    assert "TranscribedLines" not in calls


def test_page_first_positive_falls_through_to_per_region_classification(monkeypatch):
    _regions(monkeypatch, [(None, [50, 50, 450, 450]), (None, [550, 50, 950, 450]), (None, [50, 550, 450, 950])])
    calls = _fake_ollama(monkeypatch, ["teudat_zehut", "teudat_zehut", "none", "none"])  # page, then 3 regions
    result = asyncio.run(pipeline.run(_blank_page()))
    assert calls.count("FrameClass") == 4
    assert [r.document_type for r in result.regions] == ["teudat_zehut", "skipped", "skipped"]
    assert result.extraction is not None


def test_two_candidates_do_not_classify_the_page_first(monkeypatch):
    _regions(monkeypatch, [(None, [50, 50, 450, 450]), (None, [550, 50, 950, 450])])
    calls = _fake_ollama(monkeypatch, ["none", "none"])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert calls.count("FrameClass") == 2
    assert result.extraction is None


def test_a_tiny_image_is_not_a_document_without_any_classifier_call(monkeypatch):
    buf = io.BytesIO()
    Image.new("RGB", (120, 90), (250, 250, 250)).save(buf, format="JPEG")
    calls = _fake_ollama(monkeypatch, [])
    result = asyncio.run(pipeline.run(buf.getvalue()))
    assert "FrameClass" not in calls
    assert result.extraction is None and result.cheque is None
    assert [r.document_type for r in result.regions] == ["skipped"]


def test_classifier_off_ignores_geometry(monkeypatch):
    _regions(monkeypatch, [(None, [100, 100, 900, 900]), (None, [500, 500, 540, 560])])
    calls = _fake_ollama(monkeypatch, [])
    monkeypatch.setattr(config, "CLASSIFY", False)
    result = asyncio.run(pipeline.run(_blank_page()))
    assert "FrameClass" not in calls
    assert calls.count("DocumentFields") == 2  # both frames read, as before the gate
    assert all(r.document_type != "skipped" for r in result.regions)


# ------------------------------------------------- a sure kind chooses the schema

def test_a_sure_kind_overrides_the_detector_label_for_reading(monkeypatch):
    _regions(monkeypatch, [("cheque_front", [50, 100, 950, 550])])  # a 2:1 passport spread the detector calls a cheque
    calls = _fake_ollama(monkeypatch, ["foreign_passport"])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert "ChequeFields" not in calls  # no cheque detour: the identity path is taken directly
    assert "ForeignPassportFields" in calls  # and the passport's own schema, not the generic one
    assert result.extraction is not None
    assert result.regions[0].label == "cheque_front"  # regions[] still reports the detector's label


def test_an_unsure_kind_leaves_the_detector_label_in_charge(monkeypatch):
    _regions(monkeypatch, [("cheque_front", [50, 100, 950, 550])])
    calls = _fake_ollama(monkeypatch, [("foreign_passport", False)])
    result = asyncio.run(pipeline.run(_blank_page()))
    assert calls.index("ChequeFields") < calls.index("DocumentFields") if "DocumentFields" in calls else "ChequeFields" in calls
    assert result.cheque is not None  # the canned cheque answer is accepted by the cheque path


def test_a_sure_unsupported_kind_reads_with_the_generic_schema(monkeypatch):
    _regions(monkeypatch, [("cheque_front", [50, 100, 950, 550])])
    calls = _fake_ollama(monkeypatch, ["senior_citizen_card"])
    asyncio.run(pipeline.run(_blank_page()))
    assert "ChequeFields" not in calls and "DocumentFields" in calls


def test_an_inherited_cheque_back_is_read_as_a_back(monkeypatch):
    page = _cheque_front_and_back_page()
    calls = _fake_ollama(monkeypatch, ["cheque_front"])
    result = asyncio.run(pipeline.run(page))
    assert "ChequeBackFields" in calls
    assert [r.document_type for r in result.regions] == ["cheque", "cheque_back"]


def test_a_read_with_no_transcript_says_so_in_the_warnings(monkeypatch):
    """The canned transcription answers with no line at all, so the card is read straight
    from its pixels: no anchor pinned a field, no printed label opened the label gate.
    An empty `sex` on the result then means "not read", and the caller is told."""
    _fake_ollama(monkeypatch, ["teudat_zehut"])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert any("could not be transcribed" in w for w in result.warnings)


def test_a_transcribed_read_carries_no_such_warning(monkeypatch):
    _fake_ollama(monkeypatch, ["teudat_zehut"], transcript=["שם משפחה", "כהן"])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert not any("could not be transcribed" in w for w in result.warnings)


def test_the_pdf_page_note_reaches_the_result_warnings(monkeypatch):
    _fake_ollama(monkeypatch, ["none"])
    buffer = io.BytesIO()
    Image.new("RGB", (595, 842), (250, 250, 250)).save(buffer, format="PDF", save_all=True,
                                                        append_images=[Image.new("RGB", (595, 842), "white")])
    result = asyncio.run(pipeline.run(buffer.getvalue()))
    assert "1 more page(s) in the PDF were not read" in result.warnings


def test_low_resolution_card_is_warned_and_published(monkeypatch):
    """A sure card on an 850 x 1170 A4 fixture: the page (1170 px across 297 mm) says
    100 dpi, below WARN_DPI — upscaled to TARGET_DPI, its dpi published on the region and
    a warning emitted."""
    monkeypatch.setattr(config, "TARGET_DPI", 200)
    monkeypatch.setattr(config, "WARN_DPI", 150)
    _fake_ollama(monkeypatch, ["teudat_zehut"])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    card = next(r for r in result.regions if r.document_type == "teudat_zehut")
    assert card.dpi == 100
    assert any(w.startswith("The image is about 100 dpi") for w in result.warnings)


def test_a_frame_of_unknown_resolution_publishes_no_dpi_and_no_warning(monkeypatch):
    """The classifier off: no kind, and the page is A4-shaped — the page-based estimate
    still applies to sub-regions, but the whole-page frame of a blank page has none."""
    monkeypatch.setattr(config, "WARN_DPI", 150)
    _fake_ollama(monkeypatch, [])
    monkeypatch.setattr(config, "CLASSIFY", False)
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert all(r.dpi == 100 for r in result.regions)  # page-based: 1170 px / 297 mm
    assert sum("dpi" in w for w in result.warnings) == 1  # two regions, one file, one note


# ------------------------------------------------- parallel classifier calls (Anthropic)
from app.schemas import AnthropicPageExtraction, FrameClass  # noqa: E402
from tests.test_anthropic_path import _anthropic_run, _empty, _id  # noqa: E402

TWO_CARDS = [("id_card_front", [50, 50, 950, 480]), ("id_card_front", [50, 520, 950, 950])]


def _overlap_probe(monkeypatch):
    """Replace classify_frame with one that reports how many calls were in flight at once."""
    state = {"in_flight": 0, "peak": 0}

    async def classify(frame):
        state["in_flight"] += 1
        state["peak"] = max(state["peak"], state["in_flight"])
        await asyncio.sleep(0.01)  # give a concurrent sibling the chance to enter
        state["in_flight"] -= 1
        return FrameClass(kind="teudat_zehut", sure=True)

    monkeypatch.setattr(pipeline, "classify_frame", classify)
    return state


def test_anthropic_classifies_the_frames_of_a_page_concurrently(monkeypatch):
    card = _empty(AnthropicPageExtraction, document_type="teudat_zehut", sefach_present=False, id_number=_id())
    _anthropic_run(monkeypatch, [LocalRegion(label, box) for label, box in TWO_CARDS], {AnthropicPageExtraction: card})
    monkeypatch.setattr(config, "CLASSIFY", True)
    state = _overlap_probe(monkeypatch)
    result = asyncio.run(pipeline.run(_blank_page()))
    assert state["peak"] == 2
    assert [r.document_type for r in result.regions] == ["teudat_zehut", "teudat_zehut"]


def test_ollama_classifies_the_frames_of_a_page_one_at_a_time(monkeypatch):
    _regions(monkeypatch, TWO_CARDS)
    _fake_ollama(monkeypatch, [])
    state = _overlap_probe(monkeypatch)
    result = asyncio.run(pipeline.run(_blank_page()))
    assert state["peak"] == 1
    assert [r.document_type for r in result.regions] == ["teudat_zehut", "teudat_zehut"]


def test_the_usage_log_names_the_classifier_kind_even_when_unsure(monkeypatch, caplog):
    _regions(monkeypatch, [(None, [100, 100, 900, 900])])
    _fake_ollama(monkeypatch, [("foreign_passport", False)])
    with caplog.at_level("INFO", logger="makor.usage"):
        asyncio.run(pipeline.run(_blank_page()))
    lines = [r.getMessage() for r in caplog.records if "read_as=" in r.getMessage()]
    assert lines and "kind=foreign_passport" in lines[0] and "sure=False" in lines[0]


def test_the_usage_log_names_every_frames_kind_including_the_skipped_ones(monkeypatch, caplog):
    """A page with a card and a cheque: triage reads the card and skips the cheque, so the
    read loop's own log line never mentions the cheque. The measurement of a classifier
    change needs the kind of every frame, not only of the ones that were read."""
    _regions(monkeypatch, [(None, [100, 100, 900, 500]), ("cheque_front", [100, 550, 900, 900])])
    _fake_ollama(monkeypatch, ["teudat_zehut", "cheque_front"])
    with caplog.at_level("INFO", logger="makor.usage"):
        asyncio.run(pipeline.run(_blank_page()))
    lines = [r.getMessage() for r in caplog.records if "kinds=" in r.getMessage()]
    assert lines == ["backend=ollama kinds=teudat_zehut:True,cheque_front:True"]


def test_one_upload_is_warned_about_its_resolution_once(monkeypatch):
    """Every crop is cut from one upload, so its resolution is a fact about that file: the
    two regions of this page are both 100 dpi and the client is told so once, about the
    image. Per-region notes said the same thing twice and invited the question which region
    the other number belonged to."""
    _fake_sefach_ollama(monkeypatch, [_holder_json(CARD_ID, "דנה", "הרצל")])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert [w for w in result.warnings if "dpi" in w] == [
        f"The image is about 100 dpi — below the recommended {config.WARN_DPI} dpi"
    ]
