"""Unit tests for app/assemble.py's merge() and app/postprocess.py's postprocess() —
pure logic, no model calls (both operate on already-extracted DocumentExtraction objects)."""

import pytest

from app.anchors import GATED_BY_LABEL, anchor_id, anchor_labels, anchor_names, anchor_parents, anchor_sex, anchor_type, strip_niqqud
from app.assemble import merge
from app.doctypes import PRIORITY
from app.postprocess import normalize_date, postprocess
from app.schemas import DocumentExtraction, ExtractedField


def _field(value, confidence="high") -> ExtractedField:
    return ExtractedField(value=value, confidence=confidence)


def _empty_field() -> ExtractedField:
    return _field(None)


def _extraction(**overrides) -> DocumentExtraction:
    fields = {
        "document_type": "teudat_zehut",
        "last_name_he": _empty_field(),
        "first_name_he": _empty_field(),
        "last_name_en": _empty_field(),
        "first_name_en": _empty_field(),
        "id_number": _empty_field(),
        "passport_number": _empty_field(),
        "date_of_birth": _empty_field(),
        "sex": _empty_field(),
        "nationality": _empty_field(),
        "place_of_birth": _empty_field(),
        "father_name_he": _empty_field(),
        "mother_name_he": _empty_field(),
        "date_of_issue": _empty_field(),
        "date_of_expiry": _empty_field(),
        "license_number": _empty_field(),
        "address": _empty_field(),
        "categories": _empty_field(),
        "file_number": _empty_field(),
        "mrz_lines": None,
    }
    fields.update(overrides)
    return DocumentExtraction(**fields)


# --------------------------------------------------------------------------- merge()

def test_merge_single_result_is_returned_unchanged():
    card = _extraction(id_number=_field("123456782"), last_name_he=_field("כהן"))
    merged, warnings = merge([card])
    assert merged.id_number.value == "123456782"
    assert merged.last_name_he.value == "כהן"
    assert warnings == []


def test_merge_prefers_card_over_sefach_by_priority_regardless_of_input_order():
    card = _extraction(document_type="teudat_zehut", id_number=_field("123456782"), place_of_birth=_empty_field())
    sefach = _extraction(document_type="teudat_zehut_sefach", id_number=_field("123456782"), place_of_birth=_field("תל אביב"))
    merged, _ = merge([sefach, card])  # sefach listed first on purpose
    assert merged.document_type == "teudat_zehut"


def test_merge_sefach_fills_gaps_on_the_card():
    card = _extraction(document_type="teudat_zehut", id_number=_field("123456782"), place_of_birth=_empty_field())
    sefach = _extraction(document_type="teudat_zehut_sefach", id_number=_field("123456782"), place_of_birth=_field("תל אביב"))
    merged, warnings = merge([card, sefach])
    assert merged.place_of_birth.value == "תל אביב"
    assert warnings == []


def test_merge_sefach_never_overrides_a_value_already_on_the_card():
    card = _extraction(document_type="teudat_zehut", id_number=_field("123456782"), first_name_he=_field("דוד"))
    sefach = _extraction(document_type="teudat_zehut_sefach", id_number=_field("123456782"), first_name_he=_field("משה"))
    merged, warnings = merge([card, sefach])
    assert merged.first_name_he.value == "דוד"
    assert warnings == []  # disagreements from fill-only sources are silent


def test_merge_skips_a_region_belonging_to_a_different_person():
    card = _extraction(document_type="teudat_zehut", id_number=_field("123456782"), place_of_birth=_empty_field())
    childs_block = _extraction(document_type="teudat_zehut_sefach", id_number=_field("987654321"), place_of_birth=_field("חיפה"))
    merged, warnings = merge([card, childs_block])
    assert merged.place_of_birth.value is None  # not pulled in
    assert len(warnings) == 1
    assert "different person" in warnings[0]


def test_merge_conflicting_values_between_primary_documents_produce_a_warning():
    passport = _extraction(document_type="israeli_passport", id_number=_field("123456782"), last_name_en=_field("COHEN"))
    license_ = _extraction(document_type="israeli_drivers_license", id_number=_field("123456782"), last_name_en=_field("KOHEN"))
    merged, warnings = merge([passport, license_])
    assert merged.last_name_en.value == "COHEN"  # passport outranks license
    assert any("last_name_en differs" in w for w in warnings)


def test_merge_low_confidence_primary_value_yields_to_high_confidence_secondary():
    passport = _extraction(
        document_type="israeli_passport", id_number=_field("123456782"), last_name_en=_field("COHEM", confidence="low")
    )
    license_ = _extraction(
        document_type="israeli_drivers_license", id_number=_field("123456782"), last_name_en=_field("COHEN", confidence="high")
    )
    merged, warnings = merge([passport, license_])
    assert merged.last_name_en.value == "COHEN"
    assert any("last_name_en differs" in w for w in warnings)


def test_merge_deduplicates_repeated_warnings():
    card = _extraction(document_type="teudat_zehut", id_number=_field("123456782"), last_name_he=_field("כהן"))
    other_a = _extraction(document_type="israeli_passport", id_number=_field("123456782"), last_name_he=_field("קוהן"))
    other_b = _extraction(document_type="israeli_drivers_license", id_number=_field("123456782"), last_name_he=_field("קוהן"))
    merged, warnings = merge([card, other_a, other_b])
    assert warnings.count("last_name_he differs between teudat_zehut and israeli_passport") == 1


def test_merge_fills_missing_mrz_lines_from_a_secondary_region():
    card = _extraction(document_type="teudat_zehut", id_number=_field("123456782"), mrz_lines=None)
    back = _extraction(document_type="teudat_zehut_back", id_number=_field("123456782"), mrz_lines=["LINE1", "LINE2", "LINE3"])
    merged, _ = merge([card, back])
    assert merged.mrz_lines == ["LINE1", "LINE2", "LINE3"]


# --------------------------------------------------------------------------- postprocess()

def test_postprocess_strips_niqqud_from_all_fields():
    doc = _extraction(last_name_he=_field("כֹּהֵן"))
    result = postprocess(doc, anchors={})
    assert result.last_name_he.value == "כהן"


def test_strip_niqqud_leaves_plain_text_and_none_unchanged():
    assert strip_niqqud("כהן") == "כהן"
    assert strip_niqqud(None) is None


@pytest.mark.parametrize("value", ["فيل", "PISHEL", "123"])
def test_postprocess_nulls_a_hebrew_name_field_without_hebrew_letters(value):
    # Every label on an Israeli document is printed in Arabic too; the model has been
    # seen returning the Arabic line as last_name_he (the Arabic transliteration of the surname).
    result = postprocess(_extraction(document_type="teudat_zehut", last_name_he=_field(value)), anchors={})
    assert result.last_name_he.value is None and result.last_name_he.confidence == "high"


def test_postprocess_keeps_a_hebrew_name_with_punctuation():
    result = postprocess(_extraction(document_type="teudat_zehut", last_name_he=_field("בן-דוד")), anchors={})
    assert result.last_name_he.value == "בן-דוד"


def test_postprocess_nulls_fields_the_document_type_cannot_carry():
    # A teudat zehut FRONT has no sex field per CARRIED_FIELDS.
    doc = _extraction(document_type="teudat_zehut", sex=_field("M"))
    result = postprocess(doc, anchors={})
    assert result.sex.value is None
    assert result.sex.confidence == "high"


def test_postprocess_keeps_fields_the_document_type_does_carry():
    doc = _extraction(document_type="teudat_zehut", id_number=_field("123456782"))
    result = postprocess(doc, anchors={})
    assert result.id_number.value == "123456782"


def test_postprocess_carries_everything_for_passports():
    # israeli_passport carries every identity field but the licence's three -> nothing
    # here is dropped (the three are the test below).
    doc = _extraction(document_type="israeli_passport", sex=_field("F"), nationality=_field("ISR"))
    result = postprocess(doc, anchors={})
    assert result.sex.value == "F"
    assert result.nationality.value == "ISR"


def test_postprocess_drops_licence_fields_from_a_passport():
    doc = _extraction(
        document_type="israeli_passport", id_number=_field("123456782"), address=_field("רחוב"),
        license_number=_field("1234567"), categories=_field("B")
    )
    out = postprocess(doc, anchors={})
    assert (
        out.address.value is None and out.license_number.value is None
        and out.categories.value is None
    )
    assert out.id_number.value == "123456782"


def test_postprocess_applies_anchor_overrides_with_medium_confidence_when_model_had_a_value():
    # a Hebrew misread, not a Latin placeholder: postprocess nulls a Hebrew name field with no Hebrew in it
    doc = _extraction(document_type="teudat_zehut", first_name_he=_field("כהן", confidence="high"))
    result = postprocess(doc, anchors={"first_name_he": "דוד"})
    assert result.first_name_he.value == "דוד"
    assert result.first_name_he.confidence == "medium"


def test_postprocess_applies_anchor_with_high_confidence_when_model_had_nothing():
    doc = _extraction(document_type="teudat_zehut", first_name_he=_empty_field())
    result = postprocess(doc, anchors={"first_name_he": "דוד"})
    assert result.first_name_he.value == "דוד"
    assert result.first_name_he.confidence == "high"


# --------------------------------------------------------------------------- anchor_names()

def test_anchor_names_finds_family_name_above_the_first_name_label():
    lines = ["מדינת ישראל", "כהן", "השם הפרטי", "דוד", "מספר זהות"]
    anchors = anchor_names(lines)
    assert anchors == {"first_name_he": "דוד", "last_name_he": "כהן"}


def test_anchor_names_returns_empty_when_the_label_is_not_found():
    anchors = anchor_names(["some unrelated line", "another line"])
    assert anchors == {}


def test_postprocess_swaps_issue_and_expiry_when_they_are_in_the_wrong_order():
    # Seen on a driver's license with the flat model-facing schema: the same two dates,
    # assigned the wrong way round in every run.
    doc = _extraction(document_type="israeli_drivers_license",
                      date_of_issue=_field("2027-08-04"), date_of_expiry=_field("2017-09-06"))
    fixed = postprocess(doc, {})
    assert fixed.date_of_issue.value == "2017-09-06"
    assert fixed.date_of_expiry.value == "2027-08-04"
    assert fixed.date_of_issue.confidence == "medium"
    assert fixed.date_of_expiry.confidence == "medium"


def test_postprocess_nulls_an_expiry_equal_to_the_issue_date():
    # The old laminated card prints no expiry; the typed card schema copies the issue date.
    doc = _extraction(date_of_issue=_field("2017-09-06"), date_of_expiry=_field("2017-09-06"))
    fixed = postprocess(doc, {})
    assert fixed.date_of_issue.value == "2017-09-06"
    assert fixed.date_of_expiry.value is None


def test_old_card_expiry_is_nulled_whenever_an_old_card_label_is_printed():
    # The old laminated card prints no expiry at all; the label gate already knows the
    # layout from its labels, so any expiry the model invents there is dropped, not only
    # one equal to the issue date.
    doc = _extraction(document_type="teudat_zehut", date_of_issue=_field("2005-03-14"), date_of_expiry=_field("2015-03-14"))
    fixed = postprocess(doc, anchors={}, printed=frozenset({"sex"}))
    assert fixed.date_of_issue.value == "2005-03-14"
    assert (fixed.date_of_expiry.value, fixed.date_of_expiry.confidence) == (None, "low")


def test_biometric_card_keeps_its_expiry_when_no_old_card_label_is_printed():
    doc = _extraction(document_type="teudat_zehut", date_of_issue=_field("2020-01-05"), date_of_expiry=_field("2030-01-04"))
    fixed = postprocess(doc, anchors={}, printed=frozenset())
    assert fixed.date_of_expiry.value == "2030-01-04"


def test_postprocess_keeps_issue_and_expiry_that_are_in_order_or_incomplete():
    doc = _extraction(date_of_issue=_field("2017-09-06"), date_of_expiry=_field("2027-08-04"))
    fixed = postprocess(doc, {})
    assert (fixed.date_of_issue.value, fixed.date_of_expiry.value) == ("2017-09-06", "2027-08-04")
    assert fixed.date_of_issue.confidence == "high"
    lone = postprocess(_extraction(date_of_issue=_field("2027-08-04")), {})
    assert lone.date_of_issue.value == "2027-08-04" and lone.date_of_expiry.value is None


# --------------------------------------------------------------------------- driver's license extras
def test_license_keeps_license_number_address_and_categories():
    doc = _extraction(document_type="israeli_drivers_license", license_number=_field("1234567"),
                      address=_field("הרצל 5 חיפה"), categories=_field(" b "))
    fixed = postprocess(doc, {})
    assert fixed.license_number.value == "1234567"
    assert fixed.address.value == "הרצל 5 חיפה"
    assert fixed.categories.value == "B"


def test_card_front_nulls_the_license_only_fields():
    doc = _extraction(document_type="teudat_zehut", license_number=_field("1234567"),
                      address=_field("somewhere"), categories=_field("B"))
    fixed = postprocess(doc, {})
    assert fixed.license_number.value is None
    assert fixed.address.value is None
    assert fixed.categories.value is None


def test_license_carried_fields_include_the_new_ones():
    from app.doctypes import CARRIED_FIELDS, FIELDS
    for name in ("license_number", "address", "categories"):
        assert name in CARRIED_FIELDS["israeli_drivers_license"]
        assert name in FIELDS


# --------------------------------------------------------------------------- anchor_sex() / anchor_labels()
# The old laminated teudat zehut prints המין with זכר/נקבה (and the Arabic beside it);
# the biometric front prints neither. Sex on a card therefore comes from the transcript
# only — never from the model — and only when the label is printed too.


@pytest.mark.parametrize("lines, expected", [
    (["שם המשפחה", "כהן", "המין", "זכר"], "M"),
    (["המין", "נקבה"], "F"),
    (["המִין", "זָכָר"], "M"),  # niqqud in the transcript
    (["المين", "زكر", "המין"], "M"),  # the model copies the Arabic beside the Hebrew, misspelt
    (["המין", "ذكر"], "M"),
    (["המין", "أنثى"], "F"),
    (["המין", "انثى"], "F"),
])
def test_anchor_sex_reads_the_printed_word(lines, expected):
    assert anchor_sex(lines) == expected


def test_anchor_sex_needs_the_label_too():
    assert anchor_sex(["זכר"]) is None  # a lone word could be anything
    assert anchor_sex(["המין"]) is None  # the label without a value


def test_anchor_sex_ignores_a_word_embedded_in_a_longer_line():
    assert anchor_sex(["המין", "זכרון יעקב"]) is None


@pytest.mark.parametrize("lines, expected", [
    (["מקום הלידה", "ישראל"], {"place_of_birth"}),
    (["מקום לידה"], {"place_of_birth"}),
    (["המין", "מקום הלידה"], {"sex", "place_of_birth"}),
    (["שם המשפחה", "כהן"], set()),
])
def test_anchor_labels_lists_the_printed_labels(lines, expected):
    assert anchor_labels(lines) == expected


@pytest.mark.parametrize("line", [
    "בתוקף עד",      # as printed
    "בְּתֹקֶף",        # as the 8B transcribes it on the card that prints it, 2026-09-11: niqqud,
                     # the defective spelling, and the עד dropped — core "בתקף"
    "בתוקף",
])
def test_anchor_labels_reports_the_printed_validity_label(line):
    """The second old laminated layout — the parents, the grandfather, the
    place of birth, no chip — that nonetheless prints בתוקף עד and a date ten years after
    its issue. The expiry rule has to be able to see that label, in the forms the model
    actually returns it: the word alone carries the meaning, the עד does not survive."""
    assert "date_of_expiry" in anchor_labels([line, "19.11.2023"])


def test_anchor_labels_does_not_invent_a_validity_label():
    assert "date_of_expiry" not in anchor_labels(["ניתנה ב-", "ירושלים"])
    assert "date_of_expiry" not in anchor_labels(["תוקף", "משהו"])  # too short to match exactly


def test_the_validity_label_is_not_a_gated_field():
    """`printed` reports it, but GATED_BY_LABEL must not: the generic gate nulls every field
    it lists whose label is missing, and a transcript that fails would then cost a biometric
    card the expiry it really prints."""
    assert "date_of_expiry" not in GATED_BY_LABEL["teudat_zehut"]


def test_an_old_card_that_prints_a_validity_date_keeps_it():
    doc = _extraction(document_type="teudat_zehut",
                      date_of_issue=_field("2013-11-19"), date_of_expiry=_field("2023-11-19"))
    fixed = postprocess(doc, anchors={}, printed=frozenset({"sex", "place_of_birth", "date_of_expiry"}))
    assert fixed.date_of_expiry.value == "2023-11-19"


def test_an_old_card_with_no_validity_label_still_loses_its_expiry():
    doc = _extraction(document_type="teudat_zehut",
                      date_of_issue=_field("2002-02-04"), date_of_expiry=_field("2012-02-04"))
    fixed = postprocess(doc, anchors={}, printed=frozenset({"sex", "place_of_birth"}))
    assert (fixed.date_of_expiry.value, fixed.date_of_expiry.confidence) == (None, "low")


def test_card_sex_and_place_of_birth_are_kept_only_when_their_labels_are_printed():
    doc = _extraction(document_type="teudat_zehut", sex=_field("M"), place_of_birth=_field("ישראל"))
    gated = postprocess(doc.model_copy(deep=True), anchors={}, printed=frozenset())
    assert gated.sex.value is None and gated.place_of_birth.value is None
    kept = postprocess(doc.model_copy(deep=True), anchors={}, printed=frozenset({"sex", "place_of_birth"}))
    assert kept.sex.value == "M" and kept.place_of_birth.value == "ישראל"


def test_card_sex_comes_from_the_transcript_anchor_over_the_model():
    doc = _extraction(document_type="teudat_zehut", sex=_field("M"))
    result = postprocess(doc, anchors={"sex": "F"}, printed=frozenset({"sex"}))
    assert (result.sex.value, result.sex.confidence) == ("F", "medium")


def test_passport_sex_is_not_gated_by_the_transcript():
    doc = _extraction(document_type="israeli_passport", sex=_field("F"), place_of_birth=_field("חיפה"))
    result = postprocess(doc, anchors={}, printed=frozenset())
    assert result.sex.value == "F" and result.place_of_birth.value == "חיפה"


# --------------------------------------------------------------------------- foreign passports / parents on the old card


def test_foreign_passport_carries_latin_fields_but_no_hebrew_names_and_no_israeli_id():
    doc = _extraction(document_type="foreign_passport", last_name_he=_field("כהן"), id_number=_field("123456782"),
                      last_name_en=_field("COHEN"), nationality=_field("UNITED STATES OF AMERICA"),
                      passport_number=_field("X1234567"), sex=_field("F"))
    result = postprocess(doc, anchors={})
    assert result.last_name_he.value is None and result.id_number.value is None
    assert result.last_name_en.value == "COHEN" and result.nationality.value and result.passport_number.value
    assert result.sex.value == "F"  # not gated: every passport prints it


def test_foreign_passport_ranks_below_the_israeli_documents_in_merge():
    assert PRIORITY.index("foreign_passport") > PRIORITY.index("israeli_drivers_license")
    merged, warnings = merge([_extraction(document_type="foreign_passport", last_name_en=_field("COHEN"))])
    assert merged.document_type == "foreign_passport" and warnings == []


def test_card_parents_names_are_kept_only_when_their_labels_are_printed():
    doc = _extraction(document_type="teudat_zehut", father_name_he=_field("יוסף"), mother_name_he=_field("רחל"))
    gated = postprocess(doc.model_copy(deep=True), anchors={}, printed=frozenset())
    assert gated.father_name_he.value is None and gated.mother_name_he.value is None
    kept = postprocess(doc.model_copy(deep=True), anchors={}, printed=frozenset({"father_name_he", "mother_name_he"}))
    assert (kept.father_name_he.value, kept.mother_name_he.value) == ("יוסף", "רחל")


@pytest.mark.parametrize("lines, expected", [
    (["שם האב", "שם האם"], {"father_name_he", "mother_name_he"}),
    (["שם האב"], {"father_name_he"}),  # the two labels differ by one letter: no fuzzy spill-over
    (["שם האם"], {"mother_name_he"}),
    (["שם המשפחה"], set()),
])
def test_anchor_labels_tells_the_parents_labels_apart(lines, expected):
    assert anchor_labels(lines) == expected


# --------------------------------------------------------------------------- anchor_parents()
# The old laminated card prints its labels in groups followed by the values in the same
# order: שם המשפחה / השם הפרטי / שם האב (each with its Arabic twin), then family name,
# first name, father; then שם האם / תאריך הלידה / מקום הלידה, then mother, date, place.
# The model shifts the parents by one line 2/2 when asked; the transcript order is stable 3/3.

OLD_CARD_LINES = [
    "תעודת זהות", "מדינת ישראל", "1 2345678 2",
    "שם המשפחה", "اسم العائلة", "השם הפרטי", "الاسم الشخصي", "שם האב", "اسم الأب",
    "כהן", "דנה", "יוסף",
    "שם האם", "اسم الأم", "תאריך הלידה", "تاريخ الولادة", "מקום הלידה", "مكان الولادة",
    "רחל", "31.05.1992", "ישראל", "زكر", "המין",
]


def test_anchor_parents_reads_father_and_mother_from_the_grouped_layout():
    assert anchor_parents(OLD_CARD_LINES) == {"father_name_he": "יוסף", "mother_name_he": "רחל"}


def test_anchor_parents_also_pins_the_holders_names_from_the_same_run():
    # the three values after the label group are family name, first name, father
    anchors = anchor_names(OLD_CARD_LINES) | anchor_parents(OLD_CARD_LINES, with_holder=True)
    assert anchors["last_name_he"] == "כהן" and anchors["first_name_he"] == "דנה"


def test_anchor_parents_handles_a_label_value_interleaved_layout():
    lines = ["שם האב", "יוסף", "שם האם", "רחל", "תאריך הלידה", "31.05.1992"]
    assert anchor_parents(lines) == {"father_name_he": "יוסף", "mother_name_he": "רחל"}


def test_anchor_parents_gives_nothing_without_the_labels():
    assert anchor_parents(["שם המשפחה", "כהן", "השם הפרטי", "דנה"]) == {}


def test_anchor_parents_leaves_an_ambiguous_run_alone():
    # two values after the group: cannot tell which is the father
    assert "father_name_he" not in anchor_parents(["שם האב", "כהן", "דנה", "31.05.1992"])


# --------------------------------------------------------------------------- anchor_id()


@pytest.mark.parametrize("line", ["1 2345678 2", "123456782", "1-2345678-2", "מספר הזהות 1 2345678 2"])
def test_anchor_id_reads_a_check_digit_valid_id_line(line):
    assert anchor_id(["שם המשפחה", line, "כהן"]) == "123456782"


def test_anchor_id_rejects_a_line_whose_check_digit_fails():
    assert anchor_id(["1 2345678 3"]) is None  # 123456783 is the invalid control


def test_anchor_id_ignores_other_digit_runs():
    assert anchor_id(["31.05.1992", "0000123456", "80001234 11 14841 0000123456"]) is None


def test_anchored_id_overrides_the_models_misread():
    doc = _extraction(document_type="teudat_zehut", id_number=_field("23456782"))
    result = postprocess(doc, anchors={"id_number": "123456782"})
    assert (result.id_number.value, result.id_number.confidence) == ("123456782", "medium")


def test_identity_postprocess_ignores_the_cheque_anchors():
    # The transcript's reference-line anchor rides in the same dict; an identity
    # document has no such field, and an unknown type has no carried set to filter on.
    doc = _extraction(document_type="other")
    assert postprocess(doc, anchors={"bank_code": "11", "branch_number": "148"}).document_type == "other"


def test_anchors_never_fill_a_field_the_document_type_does_not_carry():
    doc = _extraction(document_type="foreign_passport")
    result = postprocess(doc, anchors={"id_number": "123456782", "last_name_he": "כהן"})
    assert result.id_number.value is None and result.last_name_he.value is None


# --------------------------------------------------------------------------- old-card labels: Arabic twins, missing mother label


@pytest.mark.parametrize("lines, expected", [
    (["الجنس"], {"sex"}),  # the Hebrew המין came out garbled on a photocopy, the Arabic twin clean
    (["مكان الولادة"], {"place_of_birth"}),
    (["اسم الأب"], {"father_name_he"}),
    (["اسم الأم"], {"mother_name_he"}),  # one letter apart from اسم الأب: exact, never fuzzy
    (["המונ", "נקרה"], set()),  # garbled beyond recognition: nothing
])
def test_anchor_labels_accepts_the_arabic_twin_of_a_label(lines, expected):
    assert anchor_labels(lines) == expected


def test_anchor_parents_takes_the_mother_from_a_four_line_run_when_her_label_is_missing():
    lines = ["שם האב", "اسم الأب", "כהן", "דנה", "יוסף", "רחל", "05.02.1968", "מקום הלידה"]
    assert anchor_parents(lines) == {"father_name_he": "יוסף", "mother_name_he": "רחל"}


def test_anchor_parents_prefers_the_labelled_mother_over_the_fourth_line():
    lines = ["שם האב", "כהן", "דנה", "יוסף", "לאה", "שם האם", "רחל"]
    assert anchor_parents(lines)["mother_name_he"] == "רחל"


# --------------------------------------------------------------------------- disability card

def test_disability_card_is_a_typed_identity_document():
    from typing import get_args

    from app.doctypes import CARRIED_FIELDS, FIELDS, IDENTITY_TYPES, KIND_TO_LABEL, LABEL_TO_TYPE, PRIORITY, UNSUPPORTED_KINDS
    from app.schemas import DocumentExtraction

    assert "disability_card" in get_args(DocumentExtraction.model_fields["document_type"].annotation)
    assert "file_number" in FIELDS and "file_number" in DocumentExtraction.model_fields
    assert CARRIED_FIELDS["disability_card"] == {"last_name_he", "first_name_he", "last_name_en", "first_name_en",
                                                 "id_number", "file_number", "date_of_expiry"}
    assert "disability_card" in IDENTITY_TYPES and "disability_card" not in UNSUPPORTED_KINDS
    assert PRIORITY.index("disability_card") > PRIORITY.index("teudat_zehut_back")  # never over a real card
    assert KIND_TO_LABEL["disability_card"] == "disability_card" and LABEL_TO_TYPE["disability_card"] == "disability_card"


@pytest.mark.parametrize("raw, expected", [("03.2014", "2014-03"), ("3/2014", "2014-03"), ("12-2031", "2031-12")])
def test_normalize_date_keeps_a_month_only_date_as_an_iso_month(raw, expected):
    # The disabled-veteran card prints its validity as MM.YYYY: no day is printed, so none
    # is invented — the ISO month is the value.
    assert normalize_date(raw) == expected


def test_disability_card_keeps_its_file_number_and_month_expiry():
    doc = postprocess(_extraction(document_type="disability_card", file_number=_field("123400001"), date_of_expiry=_field("03.2014"),
                                  last_name_en=_field("COHEN"), id_number=_field("123456782")), anchors={})
    assert doc.file_number.value == "123400001" and doc.date_of_expiry.value == "2014-03"
    assert doc.last_name_en.value == "COHEN" and doc.id_number.value == "123456782"


@pytest.mark.parametrize("doc_type", ["teudat_zehut", "israeli_passport", "israeli_drivers_license"])
def test_other_types_null_the_file_number(doc_type):
    # The passport "carries everything", and read with that schema the 8B model put the
    # printed I.D. No. into file_number (corpus run 2026-09-10): the field is the disability
    # card's alone, and no other type's schema asks for it.
    doc = postprocess(_extraction(document_type=doc_type, file_number=_field("123400001")), anchors={})
    assert doc.file_number.value is None


@pytest.mark.parametrize("lines, expected", [
    (["משרד הביטחון", "תעודת נכה", "שם"], "disability_card"),
    (["תעודת נכה צה\"ל"], "disability_card"),
    (["תעודת זהות", "שם המשפחה"], None),
    (["נכה"], None),  # the word alone is not the title
    ([], None),
    (["תעודתזהו"], None),  # the ID card's title with its last letter dropped
    (["תעודת זהו"], None),  # same drop, with the printed space kept
    (["תעודת נהות"], None),  # a single letter of the ID card's title misread (ז->נ)
])
def test_anchor_type_reads_the_disability_card_title(lines, expected):
    assert anchor_type(lines) == expected


# --------------------------------------------------------------------------- the passport type from the MRZ
from app.postprocess import passport_type_from_mrz  # noqa: E402

# ICAO 9303 specimen lines (the standard's own example person), issuing state swapped.
_TD3_ISR = ["P<ISRERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36ISR7408122F1204159ZE184226B<<<<<10"]
_TD3_UTO = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"]
_TD1 = ["I<UTOD231458907<<<<<<<<<<<<<<<", "7408122F1204159UTO<<<<<<<<<<<6", "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"]


@pytest.mark.parametrize("lines, expected", [
    (_TD3_ISR, "israeli_passport"),
    (_TD3_UTO, "foreign_passport"),
    ([_TD3_ISR[0][:42], _TD3_ISR[1]], "israeli_passport"),  # the 8B model drops trailing fillers: still decides
    # a misread digit breaks the check digits, not the state code
    ([_TD3_ISR[0], _TD3_ISR[1][:9] + "0" + _TD3_ISR[1][10:]], "israeli_passport"),
    (_TD1, None),      # a card back: no passport decision
    ([], None),
    (None, None),
    (["null"], None),
])
def test_passport_type_from_mrz_is_decided_by_the_issuing_state(lines, expected):
    assert passport_type_from_mrz(lines) == expected
