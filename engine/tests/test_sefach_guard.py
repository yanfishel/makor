"""The sefach holder guard: the card's check-digit-valid ID is ground truth for the sefach
on the same page. When the holder block disagrees with it (or shows the shift signature
first name == street) the block is re-read with other cell margins; a re-read is accepted
when its ID matches the card, or when both names match and the ID is taken from the card.

Pure decision logic first, then the pipeline wiring against canned Ollama replies."""

import asyncio
import json

import httpx
from PIL import Image, ImageDraw

from app import config, pipeline
from app.assemble import (
    apply_holder_block,
    holder_reread_verdict,
    sefach_needs_rescue,
)
from app.cropping import SEFACH_CELL_MARGIN, SEFACH_RESCUE_MARGINS, sefach_cells
from app.doctypes import FIELDS
from app.schemas import DocumentExtraction, ExtractedField, SefachAddress, SefachExtraction, SefachHolderBlock

CARD_ID = "123456782"  # valid check digit
OTHER_ID = "200000008"  # valid check digit, a different person


def _f(value, confidence="high") -> ExtractedField:
    return ExtractedField(value=value, confidence=confidence)


def _card(**overrides) -> DocumentExtraction:
    fields = {name: _f(None) for name in FIELDS}
    fields.update(document_type="teudat_zehut", id_number=_f(CARD_ID), last_name_he=_f("כהן"), first_name_he=_f("דנה"),
                  mrz_lines=None, notes=None)
    fields.update(overrides)
    return DocumentExtraction(**fields)


def _sefach(id_number=CARD_ID, first_name="דנה", street="הרצל", **overrides) -> SefachExtraction:
    fields = {
        "document_type": "teudat_zehut_sefach", "id_number": _f(id_number), "last_name_he": _f("כהן"),
        "first_name_he": _f(first_name), "previous_last_name_he": _f(None), "previous_first_name_he": _f(None),
        "maiden_name_he": _f(None), "father_name_he": _f(None), "mother_name_he": _f(None), "date_of_birth": _f(None),
        "place_of_birth": _f(None), "marital_status": _f("רווקה"), "nationality": _f(None), "date_of_issue": _f("2023-02-13"),
        "address": SefachAddress(street=street, house_number="31", entrance=None, apartment=None, city="חיפה",
                                 postal_code=None, confidence="high"),
        "spouse": None, "children": [], "notes": None,
    }
    fields.update(overrides)
    return SefachExtraction(**fields)


def _holder(id_number=CARD_ID, last_name="כהן", first_name="דנה", street="הרצל", confidence="medium") -> SefachHolderBlock:
    return SefachHolderBlock(id_number=id_number, last_name_he=last_name, first_name_he=first_name, street=street,
                             house_number="31", entrance="א", apartment=None, city="חיפה", postal_code="3100000",
                             date_of_issue="2023-02-13", confidence=confidence)


# --------------------------------------------------------------------------- when to rescue


def test_no_rescue_when_the_holder_matches_the_card():
    assert sefach_needs_rescue(_sefach(), _card()) is False


def test_rescue_when_the_holder_id_differs_from_the_card():
    assert sefach_needs_rescue(_sefach(id_number=OTHER_ID), _card()) is True


def test_rescue_on_the_shift_signature_first_name_equals_street():
    assert sefach_needs_rescue(_sefach(first_name="הרצל", street="הרצל"), _card()) is True


def test_no_rescue_without_a_card_id_to_compare_against():
    assert sefach_needs_rescue(_sefach(id_number=OTHER_ID), _card(id_number=_f(None))) is False


def test_no_rescue_when_the_holder_has_no_id_and_no_shift():
    assert sefach_needs_rescue(_sefach(id_number=None), _card()) is False


def test_leading_zeros_do_not_count_as_a_difference():
    assert sefach_needs_rescue(_sefach(id_number="012345678"), _card(id_number=_f("12345678"))) is False


# --------------------------------------------------------------------------- accepting a re-read


def test_reread_accepted_by_id_when_it_matches_the_card():
    assert holder_reread_verdict(_holder(), _card()) == "id"


def test_reread_accepted_by_names_when_both_names_match_the_card():
    assert holder_reread_verdict(_holder(id_number=OTHER_ID), _card()) == "names"


def test_reread_rejected_when_the_id_differs_and_a_name_differs():
    assert holder_reread_verdict(_holder(id_number=OTHER_ID, first_name="הרצל"), _card()) is None
    assert holder_reread_verdict(_holder(id_number=OTHER_ID, last_name="לוי"), _card()) is None


def test_reread_rejected_when_the_card_has_no_names_to_match():
    card = _card(last_name_he=_f(None), first_name_he=_f(None))
    assert holder_reread_verdict(_holder(id_number=OTHER_ID), card) is None


# --------------------------------------------------------------------------- applying it


def test_apply_by_id_takes_every_holder_field_from_the_block():
    shifted = _sefach(id_number=OTHER_ID, first_name="הרצל", street="חיפה")
    fixed = apply_holder_block(shifted, _holder(street="הרצל"), _card(), "id")
    assert (fixed.id_number.value, fixed.id_number.confidence) == (CARD_ID, "medium")
    assert fixed.first_name_he.value == "דנה"
    assert fixed.address.street == "הרצל"
    assert fixed.address.entrance == "א"
    assert fixed.date_of_issue.value == "2023-02-13"
    assert fixed.marital_status.value == "רווקה"  # the status block is not re-read
    assert shifted.first_name_he.value == "הרצל"  # the input is not mutated


def test_apply_by_names_takes_the_id_from_the_card_at_medium_confidence():
    fixed = apply_holder_block(_sefach(id_number=OTHER_ID), _holder(id_number=OTHER_ID), _card(), "names")
    assert (fixed.id_number.value, fixed.id_number.confidence) == (CARD_ID, "medium")
    assert fixed.first_name_he.value == "דנה"


def test_cells_accept_a_margin():
    sheet = Image.new("L", (400, 800), 255)
    default = {(r, c): cell.size for r, c, cell in sefach_cells(sheet)}
    wide = {(r, c): cell.size for r, c, cell in sefach_cells(sheet, margin=0.2)}
    assert wide[(1, 1)][0] > default[(1, 1)][0] and wide[(1, 1)][1] > default[(1, 1)][1]
    assert SEFACH_RESCUE_MARGINS[0] != SEFACH_CELL_MARGIN


# --------------------------------------------------------------------------- the pipeline


def _page_with_card_and_sefach() -> bytes:
    """A grey A4 page: a blue card on top, a sefach sheet (white paper under a pale blue
    grid) below it with ink in the holder block only — what the local detector needs."""
    from io import BytesIO

    page = Image.new("RGB", (850, 1170), (205, 205, 205))
    draw = ImageDraw.Draw(page)
    draw.rectangle((260, 0, 596, 206), fill=(70, 110, 190))
    draw.rectangle((135, 230, 770, 1030), fill=(252, 252, 252))
    for y in range(230, 1030, 12):
        draw.line((135, y, 770, y), fill=(150, 180, 220), width=1)
    for x in range(135, 770, 12):
        draw.line((x, 230, x, 1030), fill=(150, 180, 220), width=1)
    for y in range(260, 400, 16):  # printed values in the holder block (top right)
        draw.line((520, y, 740, y), fill=(0, 0, 0), width=3)
    buf = BytesIO()
    page.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _holder_json(id_number, first_name, street) -> str:
    return json.dumps({"id_number": id_number, "last_name_he": "כהן", "first_name_he": first_name, "street": street,
                       "house_number": "31", "entrance": None, "apartment": None, "city": "חיפה", "postal_code": None,
                       "date_of_issue": "2023-02-13", "confidence": "high"}, ensure_ascii=False)


def _fake_ollama(monkeypatch, holder_replies: list[str]):
    monkeypatch.setattr(config, "BACKEND", "ollama")
    calls: list[str] = []
    card_fields = {name: None for name in FIELDS}
    card_fields.update(id_number=CARD_ID, last_name_he="כהן", first_name_he="דנה")
    canned = {
        "TranscribedLines": json.dumps({"lines": []}),
        "DocumentFields": json.dumps({"document_type": "teudat_zehut", "mrz_lines": None, "notes": None,
                                      "uncertain_fields": [], **card_fields}, ensure_ascii=False),
    }

    async def post(self, url, *args, json=None, **kwargs):
        title = json["format"]["title"]
        calls.append(title)
        if title == "SefachHolderBlock":
            content = holder_replies.pop(0)
        else:
            content = canned[title]
        return httpx.Response(200, json={"message": {"content": content}, "done_reason": "stop"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return calls


def test_run_rescues_a_sefach_whose_holder_block_disagrees_with_the_card(monkeypatch):
    # first read: ID digits swapped + the shift (first name = street); the re-read gets the
    # names right but the ID still wrong -> accepted by names, ID taken from the card
    calls = _fake_ollama(monkeypatch, [_holder_json(OTHER_ID, "הרצל", "הרצל"), _holder_json(OTHER_ID, "דנה", "הרצל")])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert result.extraction.id_number.value == CARD_ID
    assert result.sefach is not None
    assert (result.sefach.id_number.value, result.sefach.id_number.confidence) == (CARD_ID, "medium")
    assert result.sefach.first_name_he.value == "דנה"
    assert calls.count("SefachHolderBlock") == 2
    assert "RegionDetection" not in calls
    # A rescue that worked is not a warning: the sheet is shown, and the number it took from
    # the card carries `medium`. Only the usage log records that it happened.
    assert not any("sefach" in w.lower() for w in result.warnings)


def test_run_drops_the_sefach_when_no_reread_matches_the_card(monkeypatch):
    wrong = _holder_json(OTHER_ID, "הרצל", "הרצל")
    calls = _fake_ollama(monkeypatch, [wrong, wrong, wrong])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert result.sefach is None
    assert calls.count("SefachHolderBlock") == 1 + len(SEFACH_RESCUE_MARGINS)
    # Said once. The merge skips the sefach-derived document and select_sefach drops the sheet
    # — the same fact reached the client twice, "Ignored a teudat_zehut_sefach block ..." and
    # "Ignored a sefach ...". The sefach layer is the one that knows why.
    said = [w for w in result.warnings if "different person" in w]
    assert said == ["Ignored a sefach belonging to a different person (ID number differs)"]


def test_run_does_not_reread_a_holder_block_that_matches_the_card(monkeypatch):
    calls = _fake_ollama(monkeypatch, [_holder_json(CARD_ID, "דנה", "הרצל")])
    result = asyncio.run(pipeline.run(_page_with_card_and_sefach()))
    assert result.sefach is not None and result.sefach.id_number.confidence == "high"
    assert calls.count("SefachHolderBlock") == 1
