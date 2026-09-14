"""Stage 5b: what the model returned, cleaned up deterministically.

Strip niqqud, normalise dates to ISO, null a Hebrew name field holding no Hebrew letter,
null fields the document type cannot carry, keep layout-dependent fields only when the
transcript shows their printed label, swap issue and expiry when they come back reversed,
drop the expiry the old laminated card never prints.
Every rule here is code, not prompt wording, because prompt wording does not hold.
"""

import re

from .anchors import _HEBREW_NAME_FIELDS, GATED_BY_LABEL, _hebrew_core, strip_niqqud
from .banks import BANK_NAMES_HE
from .doctypes import CARRIED_FIELDS, CHEQUE_CARRIED, FIELDS
from .mrz_check import _parse_mrz, israeli_id_checksum_valid
from .schemas import (
    ChequeDrawerBlock,
    ChequeExtraction,
    DocumentExtraction,
    ExtractedField,
    SefachAddress,
    SefachExtraction,
    SefachHolderBlock,
    SefachOldBottomBlock,
    SefachOldTopBlock,
    SefachPerson,
    SefachStatusBlock,
)

# --------------------------------------------------------------------------- the passport type from the MRZ

PASSPORT_TYPES = frozenset({"israeli_passport", "foreign_passport"})


def passport_type_from_mrz(mrz_lines: list[str] | None) -> str | None:
    """Which passport this is, decided by the TD3 issuing state: `P<ISR` is an Israeli
    passport, any other state a foreign one; None when no TD3 parses (a TD1 card back, no
    MRZ, junk). The check digits are not required — the 8B model misreads the number and
    still transcribes the state code — so the decision is the MRZ's, never the model's:
    an old non-biometric darkon read as foreign_passport 2/2 (2026-09-10) and
    lost its Hebrew names and ID to the carried-fields filter."""
    if not mrz_lines:
        return None
    checker, fields, _ = _parse_mrz(mrz_lines)
    if fields is None or checker.__class__.__name__ != "TD3CodeChecker":
        return None
    return "israeli_passport" if fields.country == "ISR" else "foreign_passport"


# --------------------------------------------------------------------------- post-processing

def postprocess(doc: DocumentExtraction, anchors: dict, printed: frozenset[str] = frozenset()) -> DocumentExtraction:
    carried = CARRIED_FIELDS.get(doc.document_type, None)
    gated = GATED_BY_LABEL.get(doc.document_type, {})
    for name in FIELDS:
        f: ExtractedField = getattr(doc, name)
        f.value = strip_niqqud(f.value)
        if name in ("date_of_birth", "date_of_issue", "date_of_expiry"):
            f.value = normalize_date(f.value)
        if name == "categories" and f.value is not None:
            f.value = ", ".join(part.strip().upper() for part in f.value.replace(";", ",").split(",") if part.strip()) or None
        if name in _HEBREW_NAME_FIELDS and f.value and not _hebrew_core(f.value):
            # Israeli documents print Arabic beside every Hebrew label; a Hebrew name
            # field with no Hebrew letter in it is the wrong line (seen: the Arabic transliteration of the surname).
            f.value, f.confidence = None, "high"
        if carried is not None and name not in carried and f.value is not None:
            f.value, f.confidence = None, "high"
        if name in gated and name not in printed and f.value is not None:
            f.value, f.confidence = None, "high"  # this layout does not print it
    for name, value in anchors.items():
        if name not in FIELDS or (carried is not None and name not in carried):
            continue  # a cheque anchor, or one this document type does not carry
        f = getattr(doc, name)
        if f.value != value:
            setattr(doc, name, ExtractedField(value=value, confidence="medium" if f.value else "high"))
    # A document is never issued after it expires. The model reads both dates right but
    # sometimes assigns them the wrong way round (driver's license, every run with the
    # flat schema) — ISO strings compare chronologically, so this is a safe, deterministic fix.
    issue, expiry = doc.date_of_issue, doc.date_of_expiry
    if _ISO_DATE.match(issue.value or "") and _ISO_DATE.match(expiry.value or "") and issue.value > expiry.value:
        doc.date_of_issue = ExtractedField(value=expiry.value, confidence="medium")
        doc.date_of_expiry = ExtractedField(value=issue.value, confidence="medium")
    # No document expires on the day it was issued. The old laminated card prints no
    # expiry at all, and read with the card's typed schema (a sure classifier kind, since
    # 2026-09-09) the 8B model copies the issue date into the expiry field at "high"; the
    # generic schema and the Anthropic reference leave it empty.
    if doc.date_of_issue.value and doc.date_of_issue.value == doc.date_of_expiry.value:
        doc.date_of_expiry = ExtractedField(value=None, confidence="low")
    # The equal-dates rule catches only the copy. The label gate knows the old laminated
    # layout from its printed labels (sex, place of birth, parents), and such a card
    # carries no expiry whatever the model puts there — UNLESS it prints one. There are
    # two old layouts: one carries the full old label set (parents, the grandfather,
    # place of birth, no chip) AND prints בתוקף עד with a date ten years after its issue,
    # while the older cards in the corpus (issued 1990-2010) print none. The Anthropic
    # path never nulls anything and reads an expiry on that one layout alone, which is the
    # measurement behind this exception (2026-09-11). So the printed validity label outranks
    # the layout: a card that shows it keeps its date.
    if gated and printed & gated.keys() and "date_of_expiry" not in printed and doc.date_of_expiry.value is not None:
        doc.date_of_expiry = ExtractedField(value=None, confidence="low")
    return doc


_DATE_DMY = re.compile(r"^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$")
_DATE_MY = re.compile(r"^\s*(\d{1,2})[./-](\d{4})\s*$")  # MM.YYYY: the disability card's validity prints no day
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_MARITAL_STATUS = {
    "רווק": "single", "רווקה": "single",
    "נשוי": "married", "נשואה": "married",
    "גרוש": "divorced", "גרושה": "divorced",
    "אלמן": "widowed", "אלמנה": "widowed",
    "פרוד": "separated", "פרודה": "separated",
}


def normalize_date(value: str | None) -> str | None:
    """DD.MM.YYYY (as printed) -> ISO; ISO and anything unrecognised pass through."""
    if not value:
        return value
    m = _DATE_DMY.match(value)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    m = _DATE_MY.match(value)
    return f"{m.group(2)}-{int(m.group(1)):02d}" if m else value.strip()  # ISO month: no day is invented


def _digits_only(value: str | None) -> str | None:
    digits = "".join(ch for ch in (value or "") if ch.isdigit())
    return digits or None


def _sex_code(value: str | None) -> str | None:
    if not value:
        return None
    v = strip_niqqud(value).upper()
    if v in ("M", "F"):
        return v
    core = _hebrew_core(v)
    if core.startswith("זכר"):
        return "M"
    if core.startswith("נקב"):
        return "F"
    return None


def marital_status_code(value: str | None) -> str | None:
    if not value:
        return None
    return _MARITAL_STATUS.get(_hebrew_core(strip_niqqud(value)))


# Non-final forms of כ מ נ פ צ cannot end a Hebrew word; a name that does is a misread
# of the last letter (seen: ב read as נ). We cannot know the right letter, so the
# value stays but its confidence is capped at "medium" for the reviewer.
_NON_FINAL_ENDING = re.compile(r"[\u05DB\u05DE\u05E0\u05E4\u05E6]$")


def suspicious_hebrew_name(value: str | None) -> bool:
    return bool(value) and bool(_NON_FINAL_ENDING.search(value.strip()))


def _cap_confidence(confidence: str) -> str:
    return "medium" if confidence == "high" else confidence


def _clean_person(person: SefachPerson) -> SefachPerson:
    person.last_name_he = strip_niqqud(person.last_name_he)
    person.first_name_he = strip_niqqud(person.first_name_he)
    person.id_number = _digits_only(person.id_number)
    person.date_of_birth = normalize_date(person.date_of_birth)
    person.sex = _sex_code(person.sex)
    if suspicious_hebrew_name(person.last_name_he) or suspicious_hebrew_name(person.first_name_he):
        person.confidence = _cap_confidence(person.confidence)
    return person


def _person_is_empty(person: SefachPerson) -> bool:
    return not any((person.last_name_he, person.first_name_he, person.id_number, person.date_of_birth))


def assemble_sefach(holder: SefachHolderBlock, status: SefachStatusBlock | None, children: list[SefachPerson]) -> SefachExtraction:
    """Fold the flat block outputs into the SefachExtraction shape: every value of a
    block gets that block's confidence."""
    def absent() -> ExtractedField:
        return ExtractedField(value=None, confidence="high")

    def held(name: str) -> ExtractedField:
        return ExtractedField(value=getattr(holder, name), confidence=holder.confidence)

    def pick(name: str) -> ExtractedField:
        return ExtractedField(value=getattr(status, name), confidence=status.confidence) if status is not None else absent()

    spouse = None
    if status is not None:
        spouse = SefachPerson(
            last_name_he=status.spouse_last_name_he, first_name_he=status.spouse_first_name_he,
            id_number=status.spouse_id_number, date_of_birth=None, sex=None, confidence=status.confidence,
        )
    return SefachExtraction(
        document_type="teudat_zehut_sefach",
        id_number=held("id_number"),
        last_name_he=held("last_name_he"),
        first_name_he=held("first_name_he"),
        previous_last_name_he=pick("previous_last_name_he"),
        previous_first_name_he=pick("previous_first_name_he"),
        maiden_name_he=pick("maiden_name_he"),
        father_name_he=absent(),
        mother_name_he=absent(),
        date_of_birth=absent(),
        place_of_birth=absent(),
        marital_status=pick("marital_status"),
        nationality=absent(),
        date_of_issue=held("date_of_issue"),
        address=SefachAddress(
            street=holder.street, house_number=holder.house_number, entrance=holder.entrance,
            apartment=holder.apartment, city=holder.city, postal_code=holder.postal_code, confidence=holder.confidence,
        ),
        spouse=spouse,
        children=list(children),
        notes=None,
    )


def assemble_sefach_old(top: SefachOldTopBlock, bottom: SefachOldBottomBlock, children: list[SefachPerson] = ()) -> SefachExtraction:
    """The older single-page sefach from its two blocks; every value of a block gets that
    block's confidence. Empty strings (the model's way of saying blank) are null."""
    def val(block, name: str) -> str | None:
        v = getattr(block, name)
        return v if v else None

    def upper(name: str) -> ExtractedField:
        return ExtractedField(value=val(top, name), confidence=top.confidence)

    def lower(name: str) -> ExtractedField:
        return ExtractedField(value=val(bottom, name), confidence=bottom.confidence)

    def absent() -> ExtractedField:
        return ExtractedField(value=None, confidence="high")

    spouse = None
    if val(bottom, "spouse_id_number") or val(bottom, "spouse_name_he"):
        spouse = SefachPerson(last_name_he=None, first_name_he=val(bottom, "spouse_name_he"),
                              id_number=val(bottom, "spouse_id_number"), date_of_birth=None, sex=None,
                              confidence=bottom.confidence)
    return SefachExtraction(
        document_type="teudat_zehut_sefach",
        id_number=upper("id_number"),
        last_name_he=upper("last_name_he"),
        first_name_he=upper("first_name_he"),
        previous_last_name_he=lower("previous_last_name_he"),
        previous_first_name_he=lower("previous_first_name_he"),
        maiden_name_he=lower("maiden_name_he"),
        father_name_he=absent(),
        mother_name_he=absent(),
        date_of_birth=absent(),
        place_of_birth=absent(),
        marital_status=lower("marital_status"),
        nationality=lower("nationality_he"),
        date_of_issue=absent(),
        address=SefachAddress(
            street=val(top, "street"), house_number=val(top, "house_number"), entrance=None,
            apartment=val(top, "apartment"), city=val(top, "city"), postal_code=val(top, "postal_code"),
            confidence=top.confidence,
        ),
        spouse=spouse,
        children=list(children),
        notes=None,
    )


def postprocess_sefach(sefach: SefachExtraction) -> SefachExtraction:
    """Deterministic clean-up of the model's sefach output: niqqud, digits-only
    IDs, ISO dates, M/F sex codes; drops blank child/spouse blocks and children
    that are really the holder (same ID number)."""
    text_fields = ["last_name_he", "first_name_he", "previous_last_name_he", "previous_first_name_he",
                   "maiden_name_he", "father_name_he", "mother_name_he", "place_of_birth", "marital_status", "nationality"]
    for name in text_fields:
        f: ExtractedField = getattr(sefach, name)
        f.value = strip_niqqud(f.value)
        if name.endswith("_name_he") and suspicious_hebrew_name(f.value):
            f.confidence = _cap_confidence(f.confidence)
    # A marital-status word is never a name: the model sometimes copies it into the
    # previous/maiden-name fields of the status block, or only there. Move it home.
    for name in ("previous_last_name_he", "previous_first_name_he", "maiden_name_he"):
        f = getattr(sefach, name)
        if marital_status_code(f.value):
            if not sefach.marital_status.value:
                sefach.marital_status = ExtractedField(value=f.value, confidence="medium")
            setattr(sefach, name, ExtractedField(value=None, confidence="high"))
    sefach.id_number.value = _digits_only(sefach.id_number.value)
    for name in ("date_of_birth", "date_of_issue"):
        f = getattr(sefach, name)
        f.value = normalize_date(f.value)
    if sefach.address is not None:
        for name in ("street", "house_number", "entrance", "apartment", "city", "postal_code"):
            setattr(sefach.address, name, strip_niqqud(getattr(sefach.address, name)) or None)
        # The old layout prints street and house number on one line; the model copies the
        # whole line as the street and the number again as house_number.
        street, number = sefach.address.street, sefach.address.house_number
        if street and number and street.endswith(" " + number):
            sefach.address.street = street[: -len(number)].rstrip()
        if not any(getattr(sefach.address, n) for n in ("street", "house_number", "city", "postal_code")):
            sefach.address = None
    if sefach.spouse is not None:
        sefach.spouse = _clean_person(sefach.spouse)
        if _person_is_empty(sefach.spouse):
            sefach.spouse = None
    holder_id = sefach.id_number.value
    children = []
    for child in sefach.children:
        child = _clean_person(child)
        if _person_is_empty(child):
            continue
        if holder_id and child.id_number == holder_id:
            continue  # the holder's ID repeated at the top of a child block
        children.append(child)
    sefach.children = children
    return sefach


# --------------------------------------------------------------------------- cheques

_CHEQUE_DIGIT_FIELDS = ("bank_code", "branch_number", "account_number", "cheque_number",
                        "drawer_id_number", "guarantor_id_number")
# ת.ז. and ח.פ. are both exactly 9 digits. Anything else in these fields is not an ID:
# the 8B model has been seen putting the branch's phone number (10 digits, printed under
# the bank logo) into drawer_id_number. Dropping it beats publishing a phone as an ID.
_CHEQUE_ID_FIELDS = ("drawer_id_number", "guarantor_id_number")
ID_DIGITS = 9
_CHEQUE_TEXT_FIELDS = [name for name, info in ChequeExtraction.model_fields.items() if info.annotation is ExtractedField]
_CHEQUE_BOOL_FIELDS = [name for name, info in ChequeExtraction.model_fields.items() if info.annotation == (bool | None)]

_AMOUNT_CURRENCY = re.compile(r'₪|ש"ח|ש״ח|שח|NIS|nis')
# "4,500.—", "1000 xx/xx", "700 xx", "15.-", "1,250.50", "240,100"
# Guard marks the writer puts around the figure so nothing can be added — "X 1400 X",
# "|1000|", "/ 8266 /" — which Claude transcribes as written; stripped before parsing.
_AMOUNT_GUARDS = re.compile(r"^[\s|/xX×]+|[\s|/xX×]+$")
_AMOUNT = re.compile(
    r"^(?P<int>\d{1,3}(?:,\d{3})+|\d+)"
    r"(?:[.,](?P<frac>\d{2}))?"
    r"(?:\s*[.,]?\s*(?:[-—–]+|[xX]{1,2}(?:/[xX\-—–]{1,2})?))?$"
)
_CHEQUE_DATE = re.compile(r"^\s*(\d{1,2})\s*[./,\-\s]\s*(\d{1,2})\s*[./,\-\s]\s*(\d{2}|\d{4})\s*$")


def normalize_amount(value: str | None) -> tuple[str | None, bool]:
    """Handwritten figure -> "4500.00". Thousands separators dropped; "—"/"xx"/"x" after
    the figure mean .00. Returns (value, parsed); unparseable text is passed through."""
    if not value:
        return value, False
    text = _AMOUNT_GUARDS.sub("", _AMOUNT_CURRENCY.sub("", value)).strip()
    m = _AMOUNT.match(text)
    if not m:
        return value.strip(), False
    return f"{int(m.group('int').replace(',', ''))}.{m.group('frac') or '00'}", True


def normalize_cheque_date(value: str | None) -> str | None:
    """Handwritten D.M.YY / D.M.YYYY -> ISO; two-digit years are 20xx; ISO and
    anything unrecognised (including impossible dates) pass through."""
    if not value:
        return value
    if _ISO_DATE.match(value.strip()):
        return value.strip()
    m = _CHEQUE_DATE.match(value)
    if not m:
        return value.strip()
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year < 100:
        year += 2000
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return value.strip()
    if month in (4, 6, 9, 11) and day > 30 or month == 2 and day > 29:
        return value.strip()
    return f"{year:04d}-{month:02d}-{day:02d}"


# Words PRINTED on the cheque form itself. When one of the two name fields comes back as
# nothing but these, the model read a label instead of the writing on it — seen on every
# sample where the payee line was blank ("שלמו ל", "בלבד" off the למוטב בלבד crossing,
# "לכבוד"). Null beats a confident wrong name; a value that also holds a real word is kept.
_CHEQUE_FORM_WORDS = {
    "שלמו", "ל", "לפקודת", "למוטב", "בלבד", "לכבוד", "חתימה", "תאריך", "סכום", "שח",
    "pay", "to", "or", "order", "only", "date", "signature", "nis",
}
_CHEQUE_LABEL_FIELDS = ("payee", "drawer_name")
# The payee line's own printed label, copied in FRONT of the handwriting: "שלמו ל <name>",
# the form's ל glued to the name ("שלמו ל<name>"), "לפקודת", "PAY TO (THE ORDER OF)". The
# model also reads the ו as ן (שלמן ל), which the word list above never matched, so a
# blank line came back as a payee. Stripped at the start only: a name that merely contains
# one of these words further on is left whole.
_PAYEE_LABEL = re.compile(r"^\s*(?:שלמ[ון]\s*ל(?:פקודת\b)?|לפקודת\b|pay\s+to\b(?:\s+the\s+order\s+of\b)?)[\s:.\-–—]*", re.IGNORECASE)


def _is_form_label(value: str | None) -> bool:
    if not value:
        return False
    words = [w for w in re.split(r"[\s.,:;/\\'\"״׳()-]+", value.lower()) if w]
    return bool(words) and all(w in _CHEQUE_FORM_WORDS for w in words)


BRANCH_DIGITS = 3
BRANCH_GROUP_DIGITS = 5  # branch + the 2 digits that follow it in the printed / MICR group


DRAWER_FIELDS = ("drawer_name", "drawer_id_number", "drawer_address", "drawer_phone")
# The drawer's name is printed with its ID label after it ("<name> ת.ז. 123456782"); read
# on the corner crop, the label and number ride into drawer_name on 2 of 9 blocks (as
# ת.ד., or reversed as ז'ת). Only a label at the END of the name counts, so a P.O. box
# (ת.ד. <number>) standing alone is left as it is.
_DRAWER_ID_LABEL = re.compile(r"""\s+(?:ת["'.]?[זד][."']?|ז["'.]?ת|ח["'.]?פ[."']?)(?:\s*[\d ]+)?\s*$""")


def _strip_drawer_id_label(name: str | None) -> str | None:
    if not name:
        return name
    return _DRAWER_ID_LABEL.sub("", name).strip() or name


def apply_drawer_block(cheque: ChequeExtraction, block: ChequeDrawerBlock) -> ChequeExtraction:
    """Fold the drawer block read from its own crop into the front, when it can be trusted.

    The block is the only place on a cheque with a ת.ז./ח.פ. number, so its ID passing the
    check digit is the evidence that the crop was read as the holder's block and not as
    stray print: then every drawer field is taken from the block, nulls included (a null
    the front had filled is the branch's address or phone, the copy this crop exists to
    keep out). Without a valid ID the front stays as it was. An ID that corrects a
    different number on the front is published at medium, as the sefach guards do."""
    block_id = _digits_only(block.drawer_id_number)
    if block_id is None or len(block_id) != ID_DIGITS or not israeli_id_checksum_valid(block_id):
        return cheque
    front_id = cheque.drawer_id_number.value
    cheque = cheque.model_copy(deep=True)
    for name in DRAWER_FIELDS:
        value = block_id if name == "drawer_id_number" else strip_niqqud(getattr(block, name))
        if name == "drawer_name":
            value = _strip_drawer_id_label(value)
        confidence = "medium" if value and name in block.uncertain_fields else "high"
        if name == "drawer_id_number" and front_id and front_id != block_id:
            confidence = "medium"
        setattr(cheque, name, ExtractedField(value=value, confidence=confidence))
    return cheque


def postprocess_cheque(cheque: ChequeExtraction, anchors: dict[str, str] | None = None) -> ChequeExtraction:
    """`anchors`: the transcript's reading of the printed reference line
    (`anchors.anchor_cheque_reference`); it overrides the model's digits on a front, the
    same way the identity anchors do, and never touches the MICR line — that stays the
    model's own reading so the cross-check still has two sources."""
    if cheque.document_type == "cheque_back":
        # Only the back is on the image, so it can carry nothing but the guarantee stamp
        # (the same rule `postprocess` applies per identity type). The Ollama back schema
        # already hides the front's fields; the full schema the Anthropic path uses does
        # not, and has been seen answering "cheque_back" with front fields filled in.
        carried = CHEQUE_CARRIED["cheque_back"]
        for name in _CHEQUE_TEXT_FIELDS:
            if name not in carried:
                setattr(cheque, name, ExtractedField(value=None, confidence="high"))
        for name in _CHEQUE_BOOL_FIELDS:
            if name not in carried:
                setattr(cheque, name, None)
        cheque.micr_line = None
    for name in _CHEQUE_TEXT_FIELDS:
        f: ExtractedField = getattr(cheque, name)
        f.value = strip_niqqud(f.value)
    for name in _CHEQUE_DIGIT_FIELDS:
        f = getattr(cheque, name)
        f.value = _digits_only(f.value)
    # The printed line's middle group is "<bank 2><branch 3 + 2 more digits>": a 5-digit
    # branch is that whole group copied, and only its first three digits are the branch.
    if cheque.branch_number.value is not None and len(cheque.branch_number.value) == BRANCH_GROUP_DIGITS:
        cheque.branch_number.value = cheque.branch_number.value[:BRANCH_DIGITS]
    for name in _CHEQUE_ID_FIELDS:
        f = getattr(cheque, name)
        if f.value is not None and len(f.value) != ID_DIGITS:
            f.value = None
    if cheque.document_type != "cheque_back":
        for name, value in (anchors or {}).items():
            if name not in CHEQUE_CARRIED["cheque"]:
                continue  # an identity anchor (the drawer's ת.ז. line yields id_number) rides in the same dict
            f = getattr(cheque, name)
            if f.value != value:
                setattr(cheque, name, ExtractedField(value=value, confidence="medium" if f.value else "high"))
        # The name is read off a logo and comes back garbled; the code is printed on the
        # reference line (anchored just above) and cross-checked against the MICR line. A
        # listed code decides the name, at the code's own confidence; an unlisted one leaves
        # the reading alone.
        listed = BANK_NAMES_HE.get(int(cheque.bank_code.value)) if cheque.bank_code.value else None
        if listed:
            cheque.bank_name = ExtractedField(value=listed, confidence=cheque.bank_code.confidence)
    if cheque.payee.value:
        cheque.payee.value = _PAYEE_LABEL.sub("", cheque.payee.value, count=1).strip() or None
    for name in _CHEQUE_LABEL_FIELDS:
        f = getattr(cheque, name)
        if _is_form_label(f.value):
            f.value = None
    cheque.amount.value, parsed = normalize_amount(cheque.amount.value)
    if cheque.amount.value and not parsed:
        cheque.amount.confidence = _cap_confidence(cheque.amount.confidence)
    cheque.date.value = normalize_cheque_date(cheque.date.value)
    return cheque
