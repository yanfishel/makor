"""cheque_check.py is pure math: MICR parsing, Hebrew amount-in-words parsing, verdicts."""

from decimal import Decimal

import pytest

from app.cheque_check import MicrParts, parse_hebrew_amount, parse_micr, validate
from tests.test_cheque import cheque

# --------------------------------------------------------------------------- parse_micr

@pytest.mark.parametrize("line", [
    "80001234 11 14841 0000123456",          # four groups, as the reference line prints it
    "⑈80001234⑈ ⑆11⑆14841⑆ 0000123456⑈",     # MICR glyphs
    ":80001234: 1114841 0000123456",           # bank and branch merged
    "80001234 11 148 41 0000123456",          # over-split middle
])
def test_parse_micr_accepts_the_printed_layouts(line):
    assert parse_micr(line) == MicrParts("80001234", "11", "148", "0000123456")


@pytest.mark.parametrize("line,branch", [
    ("5001234 10 93411 12345678", "934"),
    ("0011234 12 78300 123456", "783"),
    ("80005678 11 17541 0000234567", "175"),
])
def test_parse_micr_branch_is_the_three_digits_after_the_bank_code(line, branch):
    assert parse_micr(line).branch_number == branch


@pytest.mark.parametrize("line", [None, "", "no digits here", "12345 67", "80001234 11 0000123456"])
def test_parse_micr_rejects_junk(line):
    assert parse_micr(line) is None


# --------------------------------------------------------------------------- parse_hebrew_amount

@pytest.mark.parametrize("words,expected", [
    ('ארבעת אלפים וחמש מאות ש"ח', "4500"),
    ("אלף ש\"ח בלבד", "1000"),
    ("שבע מאות שקלים חדשים", "700"),
    ("מאתיים ארבעים אלף ומאה", "240100"),
    ("מאה עשרים וחמישה", "125"),
    ("אחד עשר", "11"),
    ("שתים עשרה", "12"),
    ("שלושים ושתיים ש\"ח ועשרים אגורות", "32.20"),
    ("אלפיים", "2000"),
    ("עשרת אלפים", "10000"),
    ("4500 ש\"ח", "4500"),
    # The 8B model truncates ש"ח to a lone ש, and writes the gershayim in any form.
    ("ארבעה אלפים וחמש מאות ש", "4500"),
    ("שבע מאות ש\u05f4ח", "700"),
    ("אלף ש''ח בלבד", "1000"),
    ("אלף ומאה שח בלבד", "1100"),
])
def test_parse_hebrew_amount_reads_cheque_wording(words, expected):
    assert parse_hebrew_amount(words) == Decimal(expected)


@pytest.mark.parametrize("words", [None, "", "בלה בלה", "מאה בננות"])
def test_parse_hebrew_amount_never_guesses(words):
    assert parse_hebrew_amount(words) is None


# --------------------------------------------------------------------------- validate

def _front(**overrides):
    base = dict(
        cheque_number="80001234", bank_code="11", branch_number="148", account_number="123456",
        drawer_id_number="123456782", amount="4500.00", amount_in_words='ארבעת אלפים וחמש מאות ש"ח',
        micr_line="80001234 11 14841 0000123456",
    )
    base.update(overrides)
    return cheque(**base)


def test_validate_verified_when_micr_matches_and_check_digit_is_valid():
    report = validate(_front())
    assert report.micr_present and report.micr_parsed
    assert report.id_number_checksum_valid is True
    assert {c.field for c in report.cross_checks} == {"cheque_number", "bank_code", "branch_number", "account_number", "amount"}
    assert all(c.match for c in report.cross_checks)
    assert report.overall == "verified"


def test_validate_compares_digits_ignoring_leading_zeros():
    report = validate(_front(account_number="0000123456"))
    assert next(c for c in report.cross_checks if c.field == "account_number").match


def test_validate_mismatch_on_a_differing_account():
    report = validate(_front(account_number="123457"))
    assert report.overall == "mismatch"


def test_validate_mismatch_on_a_bad_check_digit():
    report = validate(_front(drawer_id_number="123456783"))
    assert report.id_number_checksum_valid is False
    assert report.overall == "mismatch"


def test_validate_amount_words_disagreeing_with_the_figure_is_a_mismatch():
    report = validate(_front(amount="4600.00"))
    amount = next(c for c in report.cross_checks if c.field == "amount")
    assert (amount.visual, amount.reference, amount.match) == ("4600.00", "4500.00", False)
    assert report.overall == "mismatch"


def test_validate_is_partial_when_the_words_are_there_but_unparseable():
    """Words that read but do not parse leave the amount check unrun, exactly like words
    that never read at all: the check is reported one-sided and the cheque is not
    "verified". This replaced an earlier expectation of "verified" — an unrun check must
    not score the same as one that ran and passed."""
    report = validate(_front(amount_in_words="בלה"))
    amount = next(c for c in report.cross_checks if c.field == "amount")
    assert (amount.visual, amount.reference, amount.match) == ("4500.00", None, False)
    assert report.overall == "partial"


def test_validate_partial_when_a_compared_field_is_missing():
    report = validate(_front(branch_number=None))
    assert report.overall == "partial"


def test_validate_unverified_without_a_parseable_micr():
    assert validate(_front(micr_line=None)).overall == "unverified"
    report = validate(_front(micr_line="garbage"))
    assert report.micr_present and not report.micr_parsed and report.overall == "unverified"


def test_validate_guarantor_fields():
    report = validate(_front(guarantor_id_number="123456782"))
    assert report.guarantor_id_checksum_valid is True and report.guarantor_is_drawer is True
    report = validate(_front(guarantor_id_number="300000007"))
    assert report.guarantor_is_drawer is False and report.overall == "verified"
    report = validate(_front(guarantor_id_number="123456783"))
    assert report.guarantor_id_checksum_valid is False and report.overall == "mismatch"
    assert validate(_front()).guarantor_is_drawer is None


def test_validate_is_partial_when_the_figure_itself_does_not_parse():
    """Evidence that there was an amount to check is the field having been READ, not its
    having parsed. An amount that stays as written (postprocess leaves it, capped at
    medium) with no words beside it leaves the check unrun just the same."""
    report = validate(_front(amount="1000 xx/xx", amount_in_words=None))
    amount = next(c for c in report.cross_checks if c.field == "amount")
    assert (amount.visual, amount.reference, amount.match) == ("1000 xx/xx", None, False)
    assert report.overall == "partial"
