"""MRZ parsing and local validation (no API calls, pure math).

Both Israeli documents carry an ICAO 9303 machine-readable zone:
  - passport (darkon): TD3, 2 lines x 44 chars
  - biometric teudat zehut: TD1, 3 lines x 30 chars (on the back)
Check digits let us verify the model's transcription offline.
"""


from mrz.checker.td1 import TD1CodeChecker
from mrz.checker.td3 import TD3CodeChecker

from .schemas import CrossCheck, DocumentExtraction, ValidationReport


def israeli_id_checksum_valid(id_number: str) -> bool | None:
    """Luhn-style check digit used by Israeli ID numbers (מספר זהות)."""
    digits = "".join(ch for ch in id_number if ch.isdigit())
    if not digits or len(digits) > 9:
        return None
    digits = digits.zfill(9)
    total = 0
    for i, ch in enumerate(digits):
        n = int(ch) * (1 if i % 2 == 0 else 2)
        total += n if n < 10 else n - 9
    return total % 10 == 0


def _mrz_date_to_iso(yymmdd: str, expiry: bool = False) -> str | None:
    if not yymmdd or len(yymmdd) != 6 or not yymmdd.isdigit():
        return None
    yy, mm, dd = int(yymmdd[:2]), yymmdd[2:4], yymmdd[4:6]
    # Century heuristic: expiry dates are in the future, birth dates in the past.
    century = 2000 if (expiry or yy <= 40) else 1900
    return f"{century + yy}-{mm}-{dd}"


MRZ_LINE_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<")


# The junk floor: real MRZ lines are 30 (TD1) or 44 (TD3) characters, and the model
# drops up to 5 trailing fillers from one (the largest miscount measured, a TD3 name line
# at 39) — a TD1 name line short by that much is 25. Below it is junk ("null", a label).
MRZ_MIN_LINE_CHARS = 25


def _normalize_mrz_lines(lines: list[str]) -> list[str]:
    """Uppercase, strip spaces, and drop junk the model sometimes emits
    (e.g. the literal string "null") — real MRZ lines are 30 (TD1) or 44 (TD3)
    chars from the A-Z/0-9/< alphabet, less a few trailing fillers (MRZ_MIN_LINE_CHARS)."""
    cleaned = []
    for line in lines:
        candidate = (line or "").strip().upper().replace(" ", "")
        if len(candidate) >= MRZ_MIN_LINE_CHARS and set(candidate) <= MRZ_LINE_CHARS:
            cleaned.append(candidate)
    return cleaned


TD3_LINE_LENGTH = 44
TD1_LINE_LENGTH = 30


def _fit_trailing_fillers(line: str, length: int) -> str:
    """A line whose trailing `<` run makes it the wrong length is re-padded to the
    format's length. The 8B model miscounts that run by one to three characters
    (measured 2026-09-10: every foreign passport's TD3 name line came back 39–43 long
    and its data line exactly 44, so the whole MRZ was unparseable and the verdict
    `unverified`). No check digit depends on how many fillers close a line — a filler
    weighs 0 in every ICAO 9303 sum — so this repair can neither create nor hide a
    mismatch. A line that ends in data lost characters at unknown positions and is
    left as it is."""
    if len(line) == length or not line.endswith("<"):
        return line
    core = line.rstrip("<")
    return core.ljust(length, "<") if len(core) <= length else line


def _parse_mrz(lines: list[str]):
    """Returns (checker, fields, expected_format) or (None, None, error)."""
    normalized = _normalize_mrz_lines(lines)
    length = TD1_LINE_LENGTH if len(normalized) == 3 else TD3_LINE_LENGTH
    normalized = [_fit_trailing_fillers(line, length) for line in normalized]
    text = "\n".join(normalized)
    try:
        if len(normalized) == 3:
            checker = TD1CodeChecker(text)
        elif len(normalized) == 2:
            checker = TD3CodeChecker(text)
        else:
            return None, None, f"unexpected MRZ line count: {len(normalized)}"
        return checker, checker.fields(), None
    except Exception as exc:  # library raises on malformed length/structure
        return None, None, str(exc)


def _digits(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def validate(extraction: DocumentExtraction) -> ValidationReport:
    report = ValidationReport()

    # A foreign passport carries no teudat-zehut number: its MRZ optional data is not one
    # and the Israeli check digit does not apply.
    foreign = extraction.document_type == "foreign_passport"
    id_value = None if foreign else extraction.id_number.value
    if id_value:
        report.id_number_checksum_valid = israeli_id_checksum_valid(id_value)

    mrz_lines = _normalize_mrz_lines(extraction.mrz_lines or [])
    if not mrz_lines:
        report.overall = "unverified"
        return report

    report.mrz_present = True
    checker, fields, error = _parse_mrz(mrz_lines)
    if checker is None:
        report.mrz_checksums_valid = False
        report.overall = "unverified"
        return report

    report.mrz_checksums_valid = bool(checker)

    # In the Israeli passport TD3 the teudat-zehut number lives in optional
    # data; in the teudat-zehut TD1 the document number IS the ID number.
    mrz_id = _digits(getattr(fields, "optional_data", "") or "") or _digits(fields.document_number)

    checks = [
        CrossCheck(
            field="id_number",
            visual=_digits(id_value) or None,
            reference=mrz_id or None,
            match=bool(id_value and mrz_id and _digits(id_value).lstrip("0") == mrz_id.lstrip("0")),
        ),
        CrossCheck(
            field="date_of_birth",
            visual=extraction.date_of_birth.value,
            reference=_mrz_date_to_iso(fields.birth_date),
            match=bool(
                extraction.date_of_birth.value
                and extraction.date_of_birth.value == _mrz_date_to_iso(fields.birth_date)
            ),
        ),
        CrossCheck(
            field="date_of_expiry",
            visual=extraction.date_of_expiry.value,
            reference=_mrz_date_to_iso(fields.expiry_date, expiry=True),
            match=bool(
                extraction.date_of_expiry.value
                and extraction.date_of_expiry.value == _mrz_date_to_iso(fields.expiry_date, expiry=True)
            ),
        ),
        CrossCheck(
            field="sex",
            visual=(extraction.sex.value or "").upper() or None,
            reference=(fields.sex or "").upper() or None,
            match=bool(extraction.sex.value and extraction.sex.value.upper() == (fields.sex or "").upper()),
        ),
    ]
    if foreign:
        checks = [c for c in checks if c.field != "id_number"]
    report.cross_checks = [c for c in checks if c.visual or c.reference]

    matched = [c for c in report.cross_checks if c.match]
    comparable = [c for c in report.cross_checks if c.visual and c.reference]
    mismatched = [c for c in comparable if not c.match]

    if report.mrz_checksums_valid and comparable and not mismatched:
        report.overall = "verified"
    elif mismatched:
        report.overall = "mismatch"
    elif matched:
        report.overall = "partial"
    else:
        report.overall = "unverified"
    return report
