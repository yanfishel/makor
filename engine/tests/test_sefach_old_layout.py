"""The older single-page sefach (one column of labels, no child blocks): read as two
blocks — identity + address on top, marital status / spouse / nationality / previous
names below — with small flat schemas, no transcript. Measured 2026-09-07 on the only
live sample: one schema over the whole sheet smears the nationality into the blank name
fields 3/3 and invents a birth date when the schema offers one; the two blocks are clean 3/3.

Pure assembly / clean-up first, then the pipeline against canned Ollama replies."""

import asyncio
import json

import httpx
from PIL import Image, ImageDraw

from app import config, pipeline
from app.assemble import reconcile_sefach_names
from app.cropping import SEFACH_OLD_SPLIT, sefach_old_blocks
from app.doctypes import FIELDS
from app.postprocess import assemble_sefach_old, postprocess_sefach
from app.schemas import DocumentExtraction, ExtractedField, SefachOldBottomBlock, SefachOldTopBlock

CARD_ID = "123456782"


def _f(value, confidence="high") -> ExtractedField:
    return ExtractedField(value=value, confidence=confidence)


def _top(**overrides) -> SefachOldTopBlock:
    fields = dict(id_number="1 2345678 2", last_name_he="כהן", first_name_he="דנה", street="הרצל 22", house_number="22",
                  apartment="", city="חיפה", postal_code="3100000", confidence="high")
    fields.update(overrides)
    return SefachOldTopBlock(**fields)


def _bottom(**overrides) -> SefachOldBottomBlock:
    fields = dict(marital_status="רווקה", spouse_id_number="", spouse_name_he="", nationality_he="ישראלית",
                  maiden_name_he="", previous_last_name_he="", previous_first_name_he="", confidence="high")
    fields.update(overrides)
    return SefachOldBottomBlock(**fields)


def _card(last_name="כהן", first_name="דנה") -> DocumentExtraction:
    fields = {name: _f(None) for name in FIELDS}
    fields.update(document_type="teudat_zehut", id_number=_f(CARD_ID), last_name_he=_f(last_name),
                  first_name_he=_f(first_name), mrz_lines=None, notes=None)
    return DocumentExtraction(**fields)


# --------------------------------------------------------------------------- assembly


def test_assemble_old_sheet_maps_both_blocks_and_carries_the_nationality():
    sefach = postprocess_sefach(assemble_sefach_old(_top(), _bottom()))
    assert sefach.document_type == "teudat_zehut_sefach"
    assert sefach.id_number.value == CARD_ID
    assert (sefach.last_name_he.value, sefach.first_name_he.value) == ("כהן", "דנה")
    assert sefach.marital_status.value == "רווקה"
    assert sefach.nationality.value == "ישראלית"
    assert sefach.address.city == "חיפה" and sefach.address.postal_code == "3100000"
    assert sefach.children == [] and sefach.spouse is None
    assert sefach.date_of_birth.value is None and sefach.father_name_he.value is None


def test_empty_strings_from_the_blocks_become_null():
    sefach = postprocess_sefach(assemble_sefach_old(_top(apartment=""), _bottom(maiden_name_he="")))
    assert sefach.address.apartment is None
    assert sefach.maiden_name_he.value is None
    assert sefach.previous_last_name_he.value is None


def test_house_number_repeated_at_the_end_of_the_street_is_stripped():
    sefach = postprocess_sefach(assemble_sefach_old(_top(street="הרצל 22", house_number="22"), _bottom()))
    assert (sefach.address.street, sefach.address.house_number) == ("הרצל", "22")


def test_a_street_without_the_number_is_left_alone():
    sefach = postprocess_sefach(assemble_sefach_old(_top(street="הרצל", house_number="22"), _bottom()))
    assert sefach.address.street == "הרצל"


def test_spouse_from_the_bottom_block():
    sefach = postprocess_sefach(assemble_sefach_old(_top(), _bottom(spouse_id_number="2 0000000 8", spouse_name_he="יוסי לוי")))
    assert sefach.spouse is not None
    assert sefach.spouse.id_number == "200000008"
    assert sefach.spouse.first_name_he == "יוסי לוי"  # one printed line, kept whole


def test_block_confidence_spreads_over_its_fields():
    sefach = assemble_sefach_old(_top(confidence="medium"), _bottom(confidence="high"))
    assert sefach.id_number.confidence == "medium" and sefach.address.confidence == "medium"
    assert sefach.marital_status.confidence == "high" and sefach.nationality.confidence == "high"


def test_old_blocks_split_the_sheet_with_an_overlap():
    sheet = Image.new("L", (400, 800), 255)
    top, bottom = sefach_old_blocks(sheet)
    assert top.size[0] == bottom.size[0] == 400
    assert top.size[1] == int(800 * SEFACH_OLD_SPLIT[0]) and bottom.size[1] == 800 - int(800 * SEFACH_OLD_SPLIT[1])
    assert top.size[1] + bottom.size[1] > 800  # the two crops overlap around the cut


# --------------------------------------------------------------------------- names vs the card


def test_a_last_name_missing_its_final_letter_is_taken_from_the_card():
    sefach = postprocess_sefach(assemble_sefach_old(_top(last_name_he="כה"), _bottom()))
    fixed, warnings = reconcile_sefach_names(sefach, _card())
    assert (fixed.last_name_he.value, fixed.last_name_he.confidence) == ("כהן", "medium")
    assert warnings and "last_name_he" in warnings[0]


def test_matching_names_are_not_touched():
    sefach = postprocess_sefach(assemble_sefach_old(_top(), _bottom()))
    fixed, warnings = reconcile_sefach_names(sefach, _card())
    assert fixed.last_name_he.confidence == "high" and warnings == []


def test_an_unrelated_name_is_not_replaced():
    sefach = postprocess_sefach(assemble_sefach_old(_top(last_name_he="לוי"), _bottom()))
    fixed, warnings = reconcile_sefach_names(sefach, _card())
    assert fixed.last_name_he.value == "לוי" and warnings == []


def test_the_first_name_is_reconciled_the_same_way():
    sefach = postprocess_sefach(assemble_sefach_old(_top(first_name_he="דנ"), _bottom()))
    fixed, warnings = reconcile_sefach_names(sefach, _card())
    assert fixed.first_name_he.value == "דנה" and "first_name_he" in warnings[0]


# --------------------------------------------------------------------------- the pipeline


def _page_with_card_and_old_sefach() -> bytes:
    from io import BytesIO

    page = Image.new("RGB", (850, 1170), (205, 205, 205))
    draw = ImageDraw.Draw(page)
    draw.rectangle((260, 0, 596, 206), fill=(70, 110, 190))
    draw.rectangle((135, 230, 770, 1030), fill=(252, 252, 252))
    for y in range(230, 1030, 12):
        draw.line((135, y, 770, y), fill=(150, 180, 220), width=1)
    for x in range(135, 770, 12):
        draw.line((x, 230, x, 1030), fill=(150, 180, 220), width=1)
    for y in range(260, 400, 16):  # printed values top right, so the grid path tries its holder block first
        draw.line((520, y, 740, y), fill=(0, 0, 0), width=3)
    buf = BytesIO()
    page.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _fake_ollama(monkeypatch, replies: dict[str, list[str]]):
    """Canned Ollama bodies by schema title; the card comes back as teudat_zehut with CARD_ID."""
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
        content = replies[title].pop(0) if title in replies else canned[title]
        return httpx.Response(200, json={"message": {"content": content}, "done_reason": "stop"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return calls


EMPTY_HOLDER = json.dumps({k: None for k in ("id_number", "last_name_he", "first_name_he", "street", "house_number", "entrance",
                                              "apartment", "city", "postal_code", "date_of_issue")} | {"confidence": "high"})


def test_run_reads_an_old_layout_sefach_as_two_blocks(monkeypatch):
    calls = _fake_ollama(monkeypatch, {
        "SefachHolderBlock": [EMPTY_HOLDER],  # the 2x4 grid finds no holder: not the current layout
        "SefachOldTopBlock": [_top(last_name_he="כה", street="הרצל 22").model_dump_json()],
        "SefachOldBottomBlock": [_bottom().model_dump_json()],
    })
    result = asyncio.run(pipeline.run(_page_with_card_and_old_sefach()))
    assert result.sefach is not None
    assert result.sefach.nationality.value == "ישראלית"
    assert result.sefach.marital_status.value == "רווקה"
    assert result.sefach.address.street == "הרצל"
    assert (result.sefach.last_name_he.value, result.sefach.last_name_he.confidence) == ("כהן", "medium")
    assert result.sefach.id_number.value == CARD_ID
    assert "SefachExtraction" not in calls  # the whole-sheet schema is gone from the Ollama path
    assert calls.count("SefachOldTopBlock") == 1 and calls.count("SefachOldBottomBlock") == 1
    assert any("last_name_he" in w for w in result.warnings)


def test_run_gives_up_when_neither_layout_yields_a_holder(monkeypatch):
    blank_top = _top(id_number=None, last_name_he=None, first_name_he=None, street=None, house_number=None,
                     city=None, postal_code=None).model_dump_json()
    _fake_ollama(monkeypatch, {"SefachHolderBlock": [EMPTY_HOLDER], "SefachOldTopBlock": [blank_top],
                               "SefachOldBottomBlock": [_bottom().model_dump_json()]})
    result = asyncio.run(pipeline.run(_page_with_card_and_old_sefach()))
    assert result.sefach is None


# --------------------------------------------------------------------------- the two-column strip
from app.cropping import SEFACH_STRIP_CHILD_BAND, SEFACH_STRIP_COLUMN, sefach_strip_child_rows, sefach_strip_columns  # noqa: E402


def test_strip_columns_split_the_holder_column_from_the_children_with_an_overlap():
    strip = Image.new("L", (2200, 900), 255)
    holder, children = sefach_strip_columns(strip)
    assert holder.size[1] == children.size[1] == 900
    assert holder.size[0] == 2200 - int(2200 * SEFACH_STRIP_COLUMN[0])
    assert children.size[0] == int(2200 * SEFACH_STRIP_COLUMN[1])
    assert holder.size[0] + children.size[0] > 2200  # overlap around the divider


def test_strip_child_rows_are_four_equal_rows_inside_the_band():
    column = Image.new("L", (1000, 900), 255)
    rows = sefach_strip_child_rows(column)
    assert len(rows) == 4
    top, bottom = SEFACH_STRIP_CHILD_BAND
    assert all(r.size[0] == 1000 for r in rows)
    assert sum(r.size[1] for r in rows) > (bottom - top) * 900  # rows overlap their neighbours


def _page_with_card_and_old_strip() -> bytes:
    """The corpus strip in miniature: the 210 x 96 mm two-column sefach strip across
    the top of an A4, the card below it; black ink in the holder column and in the first
    child row of the children column only."""
    from io import BytesIO

    page = Image.new("RGB", (850, 1170), (205, 205, 205))
    draw = ImageDraw.Draw(page)
    x0, y0, x1, y1 = 40, 30, 810, 380  # 770 x 350: aspect 2.2, 27 % of the page
    draw.rectangle((x0, y0, x1, y1), fill=(252, 252, 252))
    for y in range(y0, y1, 12):
        draw.line((x0, y, x1, y), fill=(150, 180, 220), width=1)
    for x in range(x0, x1, 12):
        draw.line((x, y0, x, y1), fill=(150, 180, 220), width=1)
    w, h = x1 - x0, y1 - y0
    for y in range(y0 + 20, y0 + int(h * 0.5), 28):  # the holder column (right half); sparse, so the sheet stays pale
        draw.line((x0 + int(w * 0.6), y, x1 - 20, y), fill=(0, 0, 0), width=2)
    band_top = y0 + int(h * SEFACH_STRIP_CHILD_BAND[0])
    row_h = int(h * (SEFACH_STRIP_CHILD_BAND[1] - SEFACH_STRIP_CHILD_BAND[0]) / 4)
    for y in range(band_top + 10, band_top + row_h - 10, 20):  # the first child row (left column)
        draw.line((x0 + 30, y, x0 + int(w * 0.4), y), fill=(0, 0, 0), width=2)
    draw.rectangle((260, 500, 596, 706), fill=(70, 110, 190))
    buf = BytesIO()
    page.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


CHILD = json.dumps({"holder_id_number": CARD_ID,
                    "child": {"last_name_he": "כהן", "first_name_he": "דניאל", "id_number": "2 0000000 8",
                              "date_of_birth": "27.12.1998", "sex": "זכר", "confidence": "high"}}, ensure_ascii=False)


def test_run_reads_the_two_column_strip_as_holder_blocks_plus_child_rows(monkeypatch):
    monkeypatch.setattr(config, "CLASSIFY", False)
    calls = _fake_ollama(monkeypatch, {
        "SefachOldTopBlock": [_top().model_dump_json()],
        "SefachOldBottomBlock": [_bottom(marital_status="גרוש").model_dump_json()],
        "SefachChildBlock": [CHILD],
    })
    result = asyncio.run(pipeline.run(_page_with_card_and_old_strip()))
    assert "SefachHolderBlock" not in calls  # the 2x4 grid is not this layout
    assert calls.count("SefachOldTopBlock") == 1 and calls.count("SefachOldBottomBlock") == 1
    assert calls.count("SefachChildBlock") == 1  # three child rows carry no ink
    assert result.sefach is not None and result.sefach.id_number.value == CARD_ID
    assert result.sefach.marital_status.value == "גרוש" and result.sefach.nationality.value == "ישראלית"
    assert [c.id_number for c in result.sefach.children] == ["200000008"]
    assert result.sefach.children[0].sex == "M" and result.sefach.children[0].date_of_birth == "1998-12-27"
