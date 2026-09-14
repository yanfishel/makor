"""Unit tests for app/mrz_check.py — pure math, no API calls."""

import pytest

from app.mrz_check import israeli_id_checksum_valid, validate
from app.schemas import DocumentExtraction, ExtractedField

VALID_ISRAELI_ID = "012345674"  # independently computed Luhn-style check digit


def _empty_field() -> ExtractedField:
    return ExtractedField(value=None, confidence="high")


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


# --------------------------------------------------------------------------- israeli_id_checksum_valid

def test_israeli_id_checksum_valid_accepts_correct_check_digit():
    assert israeli_id_checksum_valid(VALID_ISRAELI_ID) is True


def test_israeli_id_checksum_valid_rejects_wrong_check_digit():
    assert israeli_id_checksum_valid("012345675") is False


def test_israeli_id_checksum_valid_pads_short_numbers_with_leading_zeros():
    # A valid 9-digit ID with a leading zero, entered without it.
    assert israeli_id_checksum_valid(VALID_ISRAELI_ID.lstrip("0")) is True


def test_israeli_id_checksum_valid_strips_non_digits():
    assert israeli_id_checksum_valid("0123 4567-4") is True


def test_israeli_id_checksum_valid_returns_none_for_empty_input():
    assert israeli_id_checksum_valid("") is None


def test_israeli_id_checksum_valid_returns_none_for_too_many_digits():
    assert israeli_id_checksum_valid("1234567890") is None


# --------------------------------------------------------------------------- validate() — no MRZ

def test_validate_without_mrz_lines_is_unverified():
    report = validate(_extraction(mrz_lines=None))
    assert report.overall == "unverified"
    assert report.mrz_present is False


def test_validate_still_checks_id_number_even_without_mrz():
    report = validate(_extraction(id_number=ExtractedField(value=VALID_ISRAELI_ID, confidence="high")))
    assert report.id_number_checksum_valid is True
    assert report.overall == "unverified"


def test_validate_with_malformed_mrz_lines_is_unverified():
    report = validate(_extraction(mrz_lines=["not a real mrz line", "still not one"]))
    assert report.mrz_present is False  # normalization drops non-MRZ-alphabet junk
    assert report.overall == "unverified"


# --------------------------------------------------------------------------- validate() — TD3 (passport)

# Canonical ICAO 9303 Doc, Part 4 sample MRZ (valid check digits, verified against
# the `mrz` library directly): document number L898902C3, nationality UTO,
# birth 1974-08-12, sex F, expiry 2012-04-15, optional data (used here as the
# holder's ID number) "184226".
TD3_LINES = [
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
]


def test_validate_td3_verified_when_all_fields_match():
    report = validate(
        _extraction(
            document_type="israeli_passport",
            id_number=ExtractedField(value="184226", confidence="high"),
            date_of_birth=ExtractedField(value="1974-08-12", confidence="high"),
            date_of_expiry=ExtractedField(value="2012-04-15", confidence="high"),
            sex=ExtractedField(value="F", confidence="high"),
            mrz_lines=TD3_LINES,
        )
    )
    assert report.mrz_present is True
    assert report.mrz_checksums_valid is True
    assert report.overall == "verified"
    assert all(c.match for c in report.cross_checks)


def test_validate_td3_mismatch_when_visual_field_disagrees_with_mrz():
    report = validate(
        _extraction(
            document_type="israeli_passport",
            id_number=ExtractedField(value="184226", confidence="high"),
            date_of_birth=ExtractedField(value="1990-01-01", confidence="high"),  # wrong on purpose
            mrz_lines=TD3_LINES,
        )
    )
    assert report.overall == "mismatch"


def test_validate_td3_verified_even_when_some_fields_are_left_blank():
    # Only id_number is comparable (others left blank); no field disagrees, so
    # a valid MRZ checksum with zero mismatches is still "verified", not "partial".
    report = validate(
        _extraction(
            document_type="israeli_passport",
            id_number=ExtractedField(value="184226", confidence="high"),
            mrz_lines=TD3_LINES,
        )
    )
    assert report.overall == "verified"


def test_validate_td3_partial_when_checksum_invalid_but_a_field_still_matches():
    # Composite check digit corrupted (last char 0 -> 1): the MRZ still parses
    # and individual fields still decode correctly, but bool(checker) is False.
    corrupted = [TD3_LINES[0], TD3_LINES[1][:-1] + "1"]
    report = validate(
        _extraction(
            document_type="israeli_passport",
            id_number=ExtractedField(value="184226", confidence="high"),
            mrz_lines=corrupted,
        )
    )
    assert report.mrz_checksums_valid is False
    assert report.overall == "partial"


# --------------------------------------------------------------------------- validate() — TD1 (card back)

# Canonical ICAO 9303 Doc, Part 5 sample MRZ (valid check digits): document
# number D23145890 (also the ID number on a TD1), birth 1974-08-12, sex F,
# expiry 2012-04-15.
TD1_LINES = [
    "I<UTOD231458907<<<<<<<<<<<<<<<",
    "7408122F1204159UTO<<<<<<<<<<<6",
    "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
]


def test_validate_td1_verified_when_all_fields_match():
    report = validate(
        _extraction(
            document_type="teudat_zehut_back",
            id_number=ExtractedField(value="D23145890", confidence="high"),
            date_of_birth=ExtractedField(value="1974-08-12", confidence="high"),
            date_of_expiry=ExtractedField(value="2012-04-15", confidence="high"),
            sex=ExtractedField(value="F", confidence="high"),
            mrz_lines=TD1_LINES,
        )
    )
    assert report.mrz_checksums_valid is True
    assert report.overall == "verified"


def test_validate_td1_id_number_cross_check_ignores_leading_zeros():
    report = validate(
        _extraction(
            document_type="teudat_zehut_back",
            id_number=ExtractedField(value="0D23145890", confidence="high"),
            mrz_lines=TD1_LINES,
        )
    )
    id_check = next(c for c in report.cross_checks if c.field == "id_number")
    assert id_check.match is True


@pytest.mark.parametrize(
    "bad_lines",
    [
        [TD3_LINES[0]],  # a single well-formed line: not 2 (TD3) or 3 (TD1)
        [TD3_LINES[0], TD3_LINES[1], TD3_LINES[0]],  # 3 lines, but TD3-length, not TD1
    ],
)
def test_validate_rejects_wrong_line_counts(bad_lines):
    report = validate(_extraction(mrz_lines=bad_lines))
    assert report.mrz_present is True  # lines pass the alphabet/length filter
    assert report.overall == "unverified"


def test_validate_foreign_passport_checks_the_mrz_but_never_an_israeli_id():
    # A foreign TD3's optional data is not a teudat-zehut number: no id cross-check, no
    # Israeli check-digit test, and the verdict rests on the MRZ digits + dates + sex.
    report = validate(_extraction(
        document_type="foreign_passport", mrz_lines=TD3_LINES, date_of_birth=ExtractedField(value="1974-08-12", confidence="high"),
        date_of_expiry=ExtractedField(value="2012-04-15", confidence="high"), sex=ExtractedField(value="F", confidence="high"),
        id_number=ExtractedField(value="123456782", confidence="high"),
    ))
    assert report.overall == "verified"
    assert report.id_number_checksum_valid is None
    assert "id_number" not in {c.field for c in report.cross_checks}


# --------------------------------------------------------------------------- trailing fillers
# The 8B model miscounts a run of `<` fillers at the END of a line by one to three
# characters (measured 2026-09-10 on every foreign passport in the corpus: the TD3 name
# line came back 39–43 characters long, the data line exactly 44). No check digit
# covers the length of a trailing filler run, so such a line is re-padded to the
# format's length before parsing; a line that ends in data is never touched.


def _td3_extraction(lines):
    return _extraction(
        document_type="foreign_passport",
        date_of_birth=ExtractedField(value="1974-08-12", confidence="high"),
        date_of_expiry=ExtractedField(value="2012-04-15", confidence="high"),
        sex=ExtractedField(value="F", confidence="high"),
        mrz_lines=lines,
    )


@pytest.mark.parametrize("name_line", [TD3_LINES[0][:-3], TD3_LINES[0][:-1], TD3_LINES[0] + "<<"])
def test_validate_td3_repads_a_name_line_with_a_miscounted_filler_run(name_line):
    report = validate(_td3_extraction([name_line, TD3_LINES[1]]))
    assert report.mrz_checksums_valid is True
    assert report.overall == "verified"


def test_validate_td3_never_pads_a_short_line_that_ends_in_data():
    # The data line lost characters, not fillers: positions are unknown, nothing to repair.
    report = validate(_td3_extraction([TD3_LINES[0], TD3_LINES[1][:-1]]))
    assert report.mrz_checksums_valid is False
    assert report.overall == "unverified"


def test_validate_td1_repads_short_optional_data_and_name_lines():
    lines = [TD1_LINES[0][:-2], TD1_LINES[1], TD1_LINES[2][:-3]]
    report = validate(
        _extraction(
            document_type="teudat_zehut_back",
            id_number=ExtractedField(value="D23145890", confidence="high"),
            date_of_birth=ExtractedField(value="1974-08-12", confidence="high"),
            mrz_lines=lines,
        )
    )
    assert report.mrz_checksums_valid is True
    assert report.overall == "verified"
