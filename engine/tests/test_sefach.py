"""Unit tests for the sefach path in app/assemble.py and app/postprocess.py — pure logic,
no model calls."""

from app.assemble import accept_reread_ids, match_sefach_by_name, sefach_payload, select_sefach
from app.cropping import sefach_cells
from app.imaging import has_ink
from app.postprocess import assemble_sefach, marital_status_code, normalize_date, postprocess, postprocess_sefach
from app.reading.backend_ollama import sefach_to_document
from app.schemas import (
    ExtractedField,
    SefachAddress,
    SefachExtraction,
    SefachHolderBlock,
    SefachPerson,
    SefachStatusBlock,
)

HOLDER_ID = "123456782"  # valid check digit
CHILD_ID = "200000008"  # valid check digit
BAD_ID = "123456789"  # invalid check digit


def _f(value, confidence="high") -> ExtractedField:
    return ExtractedField(value=value, confidence=confidence)


def _person(**overrides) -> SefachPerson:
    fields = {"last_name_he": None, "first_name_he": None, "id_number": None,
              "date_of_birth": None, "sex": None, "confidence": "high"}
    fields.update(overrides)
    return SefachPerson(**fields)


def _address(**overrides) -> SefachAddress:
    fields = {"street": None, "house_number": None, "entrance": None, "apartment": None,
              "city": None, "postal_code": None, "confidence": "high"}
    fields.update(overrides)
    return SefachAddress(**fields)


def _sefach(**overrides) -> SefachExtraction:
    fields = {
        "document_type": "teudat_zehut_sefach",
        "id_number": _f(HOLDER_ID),
        "last_name_he": _f("כהן"),
        "first_name_he": _f("דוד"),
        "previous_last_name_he": _f(None),
        "previous_first_name_he": _f(None),
        "maiden_name_he": _f(None),
        "father_name_he": _f(None),
        "mother_name_he": _f(None),
        "date_of_birth": _f(None),
        "place_of_birth": _f(None),
        "marital_status": _f(None),
        "nationality": _f(None),
        "date_of_issue": _f(None),
        "address": None,
        "spouse": None,
        "children": [],
    }
    fields.update(overrides)
    return SefachExtraction(**fields)


# --------------------------------------------------------------------------- helpers

def test_normalize_date_converts_printed_dmy_to_iso():
    assert normalize_date("13.02.2023") == "2023-02-13"
    assert normalize_date("4.8.1967") == "1967-08-04"
    assert normalize_date("2023-02-13") == "2023-02-13"
    assert normalize_date(None) is None


def test_marital_status_code_maps_both_genders_and_ignores_niqqud():
    assert marital_status_code("גרוש") == "divorced"
    assert marital_status_code("נשואה") == "married"
    assert marital_status_code("גָּרוּשׁ") == "divorced"
    assert marital_status_code("אלמן") == "widowed"
    assert marital_status_code("???") is None
    assert marital_status_code(None) is None


# --------------------------------------------------------------------------- postprocess_sefach()

def test_postprocess_sefach_cleans_ids_dates_sex_and_niqqud():
    s = _sefach(
        id_number=_f("1 2345678 2"),
        last_name_he=_f("כֹּהֵן"),
        date_of_issue=_f("13.02.2023"),
        children=[_person(first_name_he="יעל", id_number="2 0000000 8", date_of_birth="26.12.1985", sex="נקבה")],
    )
    out = postprocess_sefach(s)
    assert out.id_number.value == HOLDER_ID
    assert out.last_name_he.value == "כהן"
    assert out.date_of_issue.value == "2023-02-13"
    child = out.children[0]
    assert child.id_number == CHILD_ID
    assert child.date_of_birth == "1985-12-26"
    assert child.sex == "F"


def test_postprocess_sefach_drops_blank_blocks_and_holder_echo():
    s = _sefach(
        spouse=_person(),
        address=_address(),
        children=[
            _person(),  # blank block
            _person(first_name_he="דוד", id_number=HOLDER_ID),  # holder's ID repeated at the top of a child block
            _person(first_name_he="יעל", id_number=CHILD_ID),
        ],
    )
    out = postprocess_sefach(s)
    assert out.spouse is None
    assert out.address is None
    assert [c.first_name_he for c in out.children] == ["יעל"]


def test_postprocess_sefach_caps_confidence_of_names_ending_in_a_non_final_letter():
    s = _sefach(
        last_name_he=_f("כהנ"),  # impossible ending: non-final nun
        children=[_person(first_name_he="יעל", last_name_he="דרוסקונ", id_number=CHILD_ID, confidence="high")],
    )
    out = postprocess_sefach(s)
    assert out.last_name_he.value == "כהנ"  # value kept — we cannot guess the right letter
    assert out.last_name_he.confidence == "medium"
    assert out.children[0].confidence == "medium"
    assert postprocess_sefach(_sefach(last_name_he=_f("כהן"))).last_name_he.confidence == "high"


def test_postprocess_sefach_moves_a_marital_status_word_out_of_name_fields():
    s = _sefach(marital_status=_f("גרוש"), previous_last_name_he=_f("גרוש"), maiden_name_he=_f("גרוש"))
    out = postprocess_sefach(s)
    assert out.marital_status.value == "גרוש"
    assert out.marital_status.confidence == "high"
    assert out.previous_last_name_he.value is None
    assert out.maiden_name_he.value is None

    only_in_name = _sefach(marital_status=_f(None), previous_first_name_he=_f("נשואה"))
    out = postprocess_sefach(only_in_name)
    assert out.marital_status.value == "נשואה"
    assert out.marital_status.confidence == "medium"
    assert out.previous_first_name_he.value is None

    real_name = postprocess_sefach(_sefach(previous_last_name_he=_f("לוי")))
    assert real_name.previous_last_name_he.value == "לוי"


def test_postprocess_generic_schema_also_normalizes_dates():
    from tests.test_extraction import _extraction

    doc = _extraction(document_type="teudat_zehut", date_of_birth=_f("04.08.1967"))
    assert postprocess(doc, anchors={}).date_of_birth.value == "1967-08-04"


# --------------------------------------------------------------------------- sefach_to_document()

def test_sefach_to_document_carries_only_holder_fields():
    s = _sefach(address=_address(city="ירושלים"), marital_status=_f("גרוש"), date_of_issue=_f("2023-02-13"))
    doc = sefach_to_document(s)
    assert doc.document_type == "teudat_zehut_sefach"
    assert doc.id_number.value == HOLDER_ID
    assert doc.last_name_he.value == "כהן"
    assert doc.date_of_issue.value == "2023-02-13"
    assert doc.place_of_birth.value is None  # the address city is not a birthplace
    assert doc.sex.value is None
    assert doc.mrz_lines is None


def test_sefach_to_document_keeps_old_layout_birth_fields():
    s = _sefach(date_of_birth=_f("1967-08-04"), place_of_birth=_f("חיפה"))
    doc = sefach_to_document(s)
    assert doc.date_of_birth.value == "1967-08-04"
    assert doc.place_of_birth.value == "חיפה"


# --------------------------------------------------------------------------- select_sefach()

def test_select_sefach_keeps_the_holders_sefach():
    chosen, warnings = select_sefach([_sefach()], _card())
    assert chosen is not None
    assert warnings == []


def test_select_sefach_drops_another_persons_sefach():
    # Another number AND another name on the sheet: nothing suggests a misread.
    other = _sefach(id_number=_f("987654321"), last_name_he=_f("לוי"), first_name_he=_f("שרה"))
    chosen, warnings = select_sefach([other], _card())
    assert chosen is None
    assert any("different person" in w for w in warnings)


def test_select_sefach_keeps_a_differing_id_when_both_names_match_the_card():
    # The ID on a sefach block is the field the 8B model swaps most; the names decide.
    chosen, warnings = select_sefach([_sefach(id_number=_f("987654321"))], _card())
    assert chosen is not None
    assert chosen.id_number.value == HOLDER_ID and chosen.id_number.confidence == "medium"
    assert any("both names match" in w for w in warnings)


def test_select_sefach_keeps_an_unnamed_sheet_and_says_it_is_unverified():
    # A 100 dpi sheet whose holder names did not come back at all. Dropping it
    # threw away the address and the children too; it is kept, its ID marked low, with a warning.
    sheet = _sefach(id_number=_f("987654321"), last_name_he=_f(None), first_name_he=_f(None))
    chosen, warnings = select_sefach([sheet], _card())
    assert chosen is not None
    assert chosen.id_number.value == "987654321" and chosen.id_number.confidence == "low"
    assert any("check that it belongs" in w for w in warnings)


def _card(**overrides):
    from app.schemas import DocumentExtraction
    from tests.test_extraction import _extraction
    fields = {"document_type": "teudat_zehut", "id_number": _f(HOLDER_ID), "last_name_he": _f("כהן"), "first_name_he": _f("דוד")}
    fields.update(overrides)
    doc = _extraction(**fields)
    assert isinstance(doc, DocumentExtraction)
    return doc


def test_match_sefach_by_name_accepts_a_misread_id_when_the_names_match():
    # Read from its own crop, the sefach's spaced ID comes back with the flanking digits
    # swapped (seen on the Anthropic route, 2 of 22 samples); the card on the same page
    # is ground truth, and the names say whose paper it is. Same rule as the holder
    # re-read verdict on the Ollama path.
    fixed, card_id = match_sefach_by_name(_sefach(id_number=_f(BAD_ID)), _card())
    assert (fixed.id_number.value, fixed.id_number.confidence) == (HOLDER_ID, "medium")
    assert card_id.value == HOLDER_ID and card_id.confidence == "high"  # the card was right


def test_match_sefach_by_name_accepts_a_last_name_one_letter_off_when_the_first_name_matches():
    assert match_sefach_by_name(_sefach(id_number=_f(BAD_ID), last_name_he=_f("כוהן")), _card()) is not None


def test_match_sefach_by_name_rejects_a_misread_id_when_the_names_differ():
    assert match_sefach_by_name(_sefach(id_number=_f(BAD_ID), first_name_he=_f("משה")), _card()) is None


def test_match_sefach_by_name_rejects_a_valid_different_id_even_when_the_names_match():
    # A check-digit-valid ID that differs is evidence, not a misread: two relatives with
    # the same names on one page stay two people.
    assert match_sefach_by_name(_sefach(id_number=_f("200000008")), _card()) is None


def test_match_sefach_by_name_takes_the_sefachs_valid_id_when_the_cards_fails_its_check_digit():
    # The mirror case, seen on the same wallet scan: the card crop misreads the spaced ID
    # and the sefach reads it right. A check-digit-valid ID next to an invalid one with
    # the same names on both is the person's real number.
    fixed, card_id = match_sefach_by_name(_sefach(), _card(id_number=_f(BAD_ID)))
    assert fixed.id_number.value == HOLDER_ID
    assert (card_id.value, card_id.confidence) == (HOLDER_ID, "medium")


def test_match_sefach_by_name_keeps_the_cards_id_when_both_fail():
    fixed, card_id = match_sefach_by_name(_sefach(id_number=_f("123456780")), _card(id_number=_f(BAD_ID)))
    assert (fixed.id_number.value, fixed.id_number.confidence) == (BAD_ID, "medium") and card_id.value == BAD_ID


def test_accept_reread_ids_takes_the_re_read_number_both_sides_agree_on():
    # Both crops misread the spaced ID (the card's into a permutation that even passes
    # the check digit); the targeted re-read returns the printed number on both.
    fixed, card_id = accept_reread_ids(_sefach(id_number=_f(BAD_ID)), _card(id_number=_f("123456287")), HOLDER_ID, HOLDER_ID)
    assert (fixed.id_number.value, fixed.id_number.confidence) == (HOLDER_ID, "medium")
    assert (card_id.value, card_id.confidence) == (HOLDER_ID, "medium")


def test_accept_reread_ids_keeps_confidence_where_the_re_read_confirms_the_first_read():
    fixed, card_id = accept_reread_ids(_sefach(id_number=_f(BAD_ID)), _card(), HOLDER_ID, HOLDER_ID)
    assert card_id.confidence == "high" and fixed.id_number.confidence == "medium"


def test_accept_reread_ids_rejects_a_re_read_that_still_disagrees():
    assert accept_reread_ids(_sefach(id_number=_f(BAD_ID)), _card(), HOLDER_ID, "200000008") is None
    assert accept_reread_ids(_sefach(id_number=_f(BAD_ID)), _card(), None, HOLDER_ID) is None


def test_accept_reread_ids_rejects_an_agreed_number_that_fails_its_check_digit():
    assert accept_reread_ids(_sefach(), _card(id_number=_f("123456287")), BAD_ID, BAD_ID) is None


def test_match_sefach_by_name_is_a_no_op_on_a_matching_id():
    assert match_sefach_by_name(_sefach(), _card()) is None


def test_select_sefach_tolerates_missing_ids_on_either_side():
    assert select_sefach([_sefach(id_number=_f(None))], _card())[0] is not None
    assert select_sefach([_sefach()], None)[0] is not None


def test_select_sefach_warns_on_bad_child_and_spouse_check_digits():
    s = _sefach(children=[_person(first_name_he="יעל", id_number=BAD_ID)], spouse=_person(id_number=BAD_ID))
    _, warnings = select_sefach([s], _card())
    assert "Sefach: child #1 ID number failed its check-digit test" in warnings
    assert "Sefach: spouse ID number failed its check-digit test" in warnings


def test_select_sefach_keeps_first_of_several():
    first, second = _sefach(), _sefach(last_name_he=_f("לוי"))
    chosen, warnings = select_sefach([first, second], _card())
    assert chosen is first
    assert any("Several sefach" in w for w in warnings)


# --------------------------------------------------------------------------- sefach_payload()

def test_sefach_payload_adds_marital_status_code_and_hides_document_type():
    payload = sefach_payload(_sefach(marital_status=_f("נשואה")))
    assert payload["marital_status_code"] == "married"
    assert "document_type" not in payload
    assert payload["children"] == []


# --------------------------------------------------------------------------- grid helpers

def test_sefach_cells_are_in_hebrew_reading_order_and_overlap():
    from PIL import Image

    sheet = Image.new("RGB", (600, 800), "white")
    cells = sefach_cells(sheet)
    assert len(cells) == 8
    assert [(r, c) for r, c, _ in cells][:4] == [(0, 0), (0, 1), (1, 0), (1, 1)]
    holder = cells[0][2]  # (0, 0) = top-RIGHT block, extended by the margin
    assert holder.size[0] > 300 and holder.size[1] > 200


def test_has_ink_distinguishes_printed_values_from_a_blank_pale_form():
    from PIL import Image, ImageDraw

    blank = Image.new("RGB", (300, 200), (230, 240, 250))
    assert not has_ink(blank)
    printed = blank.copy()
    ImageDraw.Draw(printed).rectangle((100, 90, 140, 100), fill=(0, 0, 0))  # ~0.7% dark pixels
    assert has_ink(printed)


def _holder_block(**overrides) -> SefachHolderBlock:
    fields = {"id_number": HOLDER_ID, "last_name_he": "כהן", "first_name_he": "דוד", "street": None,
              "house_number": None, "entrance": None, "apartment": None, "city": "ירושלים",
              "postal_code": None, "date_of_issue": "2023-02-13", "confidence": "high"}
    fields.update(overrides)
    return SefachHolderBlock(**fields)


def _status_block(**overrides) -> SefachStatusBlock:
    fields = {"id_number": HOLDER_ID, "previous_last_name_he": None, "previous_first_name_he": None,
              "maiden_name_he": None, "marital_status": "גרוש", "spouse_id_number": None,
              "spouse_last_name_he": None, "spouse_first_name_he": None, "confidence": "high"}
    fields.update(overrides)
    return SefachStatusBlock(**fields)


def test_assemble_sefach_combines_blocks_and_tolerates_a_missing_status_block():
    full = assemble_sefach(_holder_block(), _status_block(), [_person(first_name_he="יעל", id_number=CHILD_ID)])
    assert full.id_number.value == HOLDER_ID
    assert full.last_name_he.value == "כהן"
    assert full.marital_status.value == "גרוש"
    assert full.address.city == "ירושלים"
    assert full.date_of_issue.value == "2023-02-13"
    assert len(full.children) == 1
    assert full.date_of_birth.value is None  # current layout: no birth fields for the holder

    bare = assemble_sefach(_holder_block(), None, [])
    assert bare.marital_status.value is None
    assert bare.spouse is None


def test_assemble_sefach_applies_the_block_confidence_to_every_field_of_that_block():
    full = assemble_sefach(_holder_block(confidence="medium"), _status_block(confidence="low"), [])
    assert full.last_name_he.confidence == "medium"
    assert full.address.confidence == "medium"
    assert full.marital_status.confidence == "low"


def test_assemble_sefach_builds_the_spouse_from_the_status_block():
    status = _status_block(spouse_id_number=CHILD_ID, spouse_last_name_he="כהן", spouse_first_name_he="רות", confidence="medium")
    full = assemble_sefach(_holder_block(), status, [])
    assert full.spouse.id_number == CHILD_ID
    assert full.spouse.first_name_he == "רות"
    assert full.spouse.confidence == "medium"
    # spouse block prints no sex / birth date
    assert full.spouse.sex is None and full.spouse.date_of_birth is None


def test_sefach_to_document_carries_the_parents_names():
    doc = sefach_to_document(_sefach(father_name_he=_f("יוסף"), mother_name_he=_f("רחל")))
    assert (doc.father_name_he.value, doc.mother_name_he.value) == ("יוסף", "רחל")
