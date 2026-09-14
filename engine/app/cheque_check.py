"""Cheque validation — pure math, no model calls.

The MICR line at the bottom of an Israeli cheque repeats the printed reference line
"<cheque number> <bank code> <branch + 2 digits> <account number>"; comparing the two
plays the MRZ's role for identity documents. The amount in words is parsed with a
bounded Hebrew numeral vocabulary and compared with the figure. ID numbers (ת.ז.) and
company numbers (ח.פ.) share the Israeli check digit.
"""

import re
from dataclasses import dataclass
from decimal import Decimal

from .mrz_check import israeli_id_checksum_valid
from .schemas import ChequeExtraction, CrossCheck, ValidationReport


@dataclass(frozen=True)
class MicrParts:
    cheque_number: str
    bank_code: str
    branch_number: str
    account_number: str


def parse_micr(line: str | None) -> MicrParts | None:
    """Digit groups of the MICR (or reference) line. The separator glyphs ⑈ ⑆ come back
    from the model as anything, so only digits count: first group = cheque number, last
    = account, everything between = bank code (2 digits) + branch (3) + 2 uninterpreted."""
    groups = re.findall(r"\d+", line or "")
    if len(groups) < 3:
        return None
    middle = "".join(groups[1:-1])
    if len(middle) < 5:
        return None
    return MicrParts(groups[0], middle[:2], middle[2:5], groups[-1])


# --------------------------------------------------------------------------- amount in words

_UNITS = {
    "אחד": 1, "אחת": 1, "שניים": 2, "שתיים": 2, "שני": 2, "שתי": 2, "שנים": 2, "שתים": 2,
    "שלושה": 3, "שלוש": 3, "שלושת": 3, "ארבעה": 4, "ארבע": 4, "ארבעת": 4,
    "חמישה": 5, "חמש": 5, "חמשת": 5, "שישה": 6, "שש": 6, "ששת": 6,
    "שבעה": 7, "שבע": 7, "שבעת": 7, "שמונה": 8, "שמונת": 8, "תשעה": 9, "תשע": 9, "תשעת": 9,
    "עשרה": 10, "עשר": 10, "עשרת": 10,
}
_TENS = {"עשרים": 20, "שלושים": 30, "ארבעים": 40, "חמישים": 50, "שישים": 60, "שבעים": 70, "שמונים": 80, "תשעים": 90}
# Ends the shekel part (what follows is agorot). Quote marks are dropped in _tokens,
# so ש"ח / ש״ח arrive as "שח"; a lone "ש" is the 8B model's usual truncation of it.
_SHEKEL = {"שח", "ש", "שקל", "שקלים", "₪"}
_AGOROT = {"אגורות", "אגורה", "אג"}
_FILLERS = {"חדשים", "חדש", "בלבד", "ו"}
_SCALE = {"מאה", "מאתיים", "מאות", "אלף", "אלפיים", "אלפים"}


def _tokens(words: str) -> list[str]:
    cleaned = re.sub(r"[\u0591-\u05C7]", "", words)  # niqqud
    cleaned = re.sub(r"[,.;:()\-–—/]", " ", cleaned)
    cleaned = re.sub(r"['\"״׳']", "", cleaned)  # gershayim: ש"ח -> שח, whatever form the model wrote
    return [t for t in cleaned.split() if t]


def parse_hebrew_amount(words: str | None) -> Decimal | None:
    """Amount in words as written on cheques -> Decimal, or None on any unknown word."""
    if not words:
        return None
    total, current, agorot = 0, 0, None
    for token in _tokens(words):
        if token in _FILLERS:
            continue
        known = _UNITS.keys() | _TENS.keys() | _SCALE | _AGOROT | _SHEKEL
        if token.startswith("ו") and len(token) > 1 and token[1:] in known:
            token = token[1:]  # "וחמש" -> "חמש"
        if token.isdigit():
            current += int(token)
        elif token in _UNITS:
            value = _UNITS[token]
            current += 10 if value == 10 and 1 <= current % 100 <= 9 else value  # "אחד עשר" = 11
        elif token in _TENS:
            current += _TENS[token]
        elif token == "מאה":
            current += 100
        elif token == "מאתיים":
            current += 200
        elif token == "מאות":
            current = (current or 1) * 100
        elif token == "אלף":
            total += (current or 1) * 1000
            current = 0
        elif token == "אלפיים":
            total += 2000
            current = 0
        elif token == "אלפים":
            total += (current or 1) * 1000
            current = 0
        elif token in _SHEKEL:
            total += current
            current = 0
        elif token in _AGOROT:
            agorot, current = current, 0
        else:
            return None
    shekels = total + current
    if shekels == 0 and agorot is None:
        return None
    return Decimal(shekels) + (Decimal(agorot) / 100 if agorot else 0)


def format_amount(value: Decimal) -> str:
    return f"{value:.2f}"


# --------------------------------------------------------------------------- validate

def _digits(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _check(field: str, visual: str | None, reference: str | None) -> CrossCheck:
    a, b = _digits(visual).lstrip("0"), _digits(reference).lstrip("0")
    return CrossCheck(field=field, visual=visual, reference=reference, match=bool(visual and reference and a == b))


def validate(cheque: ChequeExtraction) -> ValidationReport:
    report = ValidationReport()
    drawer_id = cheque.drawer_id_number.value
    if drawer_id:
        report.id_number_checksum_valid = israeli_id_checksum_valid(drawer_id)
    guarantor_id = cheque.guarantor_id_number.value
    if guarantor_id:
        report.guarantor_id_checksum_valid = israeli_id_checksum_valid(guarantor_id)
        if drawer_id:
            report.guarantor_is_drawer = _digits(guarantor_id).lstrip("0") == _digits(drawer_id).lstrip("0")

    checks: list[CrossCheck] = []
    figure = None
    if cheque.amount.value:
        try:
            figure = Decimal(cheque.amount.value)
        except ArithmeticError:
            figure = None
    words = parse_hebrew_amount(cheque.amount_in_words.value)
    # Registered whenever EITHER side was READ, not only when both PARSED: a one-sided check
    # is what makes an amount that could not be cross-checked visible in the report and
    # keeps the verdict at "partial" below. Dropping it, as this did, let a cheque whose
    # amount in words never read score the same as one where the two agreed. The trigger is
    # the raw field, like the guarantee block below — an amount that stays as written
    # (postprocess leaves an unparseable one alone) is still an amount that wanted checking.
    # `reference` stays None for words that do not parse: putting the raw words there would
    # make the check comparable and turn "could not check" into a mismatch.
    if cheque.amount.value or cheque.amount_in_words.value:
        checks.append(CrossCheck(
            field="amount",
            visual=format_amount(figure) if figure is not None else cheque.amount.value,
            reference=format_amount(words) if words is not None else None,
            match=figure is not None and words is not None and figure == words,
        ))

    report.micr_present = cheque.micr_line is not None
    micr = parse_micr(cheque.micr_line)
    report.micr_parsed = micr is not None
    if micr is not None:
        checks += [
            _check("cheque_number", cheque.cheque_number.value, micr.cheque_number),
            _check("bank_code", cheque.bank_code.value, micr.bank_code),
            _check("branch_number", cheque.branch_number.value, micr.branch_number),
            _check("account_number", cheque.account_number.value, micr.account_number),
        ]
    report.cross_checks = [c for c in checks if c.visual or c.reference]

    comparable = [c for c in report.cross_checks if c.visual and c.reference]
    mismatched = [c for c in comparable if not c.match]
    bad_digit = report.id_number_checksum_valid is False or report.guarantor_id_checksum_valid is False
    # A guarantee stamp that was read while its ID was not leaves the check-digit test
    # unrun, and an unrun check must not read as a passed one: without this the verdict
    # rewards reading less than reading badly (an ID that fails its check digit is a
    # mismatch; an ID that never read at all would otherwise be "verified"). Measured on
    # two sample cheques, where a contrast filter dropped the guarantor ID and the verdict
    # rose from mismatch to verified. A front-only cheque carries no guarantee block at
    # all and is unaffected.
    guarantee_unrun = bool(cheque.guarantor_name.value or cheque.guarantor_signed) \
        and report.guarantor_id_checksum_valid is None
    if mismatched or bad_digit:
        report.overall = "mismatch"
    elif micr is None:
        report.overall = "unverified"
    elif guarantee_unrun or len(comparable) != len(report.cross_checks):
        report.overall = "partial"
    else:
        report.overall = "verified"
    return report
