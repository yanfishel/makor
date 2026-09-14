from typing import Literal

from pydantic import BaseModel

Confidence = Literal["high", "medium", "low"]


class ExtractedField(BaseModel):
    """A single field read from the document image.

    Both fields are intentionally required (no defaults): defaults would make
    them optional in the JSON schema, letting schema-constrained local models
    legally emit `{}` instead of extracting anything.
    """

    value: str | None
    confidence: Confidence


class DocumentExtraction(BaseModel):
    """What the vision model returns (structured output schema)."""

    document_type: Literal[
        "teudat_zehut",  # Israeli ID card (biometric or laminated), front
        "teudat_zehut_back",
        "teudat_zehut_sefach",  # paper appendix (ספח) with address / family details
        "israeli_passport",
        "foreign_passport",  # any non-Israeli passport: MRZ (TD3), Latin names, nationality — no Hebrew names, no ID number
        "israeli_drivers_license",
        "disability_card",  # a card with a photo, ID and file number (the disabled-veteran card seen; a percentage card would join here)
        "cheque",  # bank cheque front (or front + back); extracted with ChequeExtraction
        "cheque_back",  # only the back of a cheque is visible
        "other",
        "unreadable",
    ]
    # Names as printed in Hebrew
    last_name_he: ExtractedField
    first_name_he: ExtractedField
    # Names in Latin letters (from MRZ or the Latin line on the document)
    last_name_en: ExtractedField
    first_name_en: ExtractedField
    # 9-digit Israeli ID number (מספר זהות)
    id_number: ExtractedField
    # Passport number, if the document is a passport
    passport_number: ExtractedField
    date_of_birth: ExtractedField  # ISO YYYY-MM-DD
    sex: ExtractedField  # "M" / "F"
    nationality: ExtractedField
    place_of_birth: ExtractedField
    father_name_he: ExtractedField  # old laminated teudat zehut only (שם האב)
    mother_name_he: ExtractedField  # old laminated teudat zehut only (שם האם)
    date_of_issue: ExtractedField  # ISO YYYY-MM-DD
    date_of_expiry: ExtractedField  # ISO YYYY-MM-DD
    # Driver's license only (field numbers of the Israeli license layout):
    license_number: ExtractedField  # 4d — מספר רישיון, not the ID number (that is field 5)
    address: ExtractedField  # 8 — one printed line; the sefach's address is structured in SefachExtraction
    categories: ExtractedField  # 9 — vehicle categories as printed, e.g. "B" or "A1, B"
    # Disability card only: the issuer's file number (מס' תיק), not the ID number
    file_number: ExtractedField
    # Raw MRZ lines exactly as printed, if a machine-readable zone is visible.
    # Required-but-nullable so the model must explicitly look for an MRZ.
    mrz_lines: list[str] | None
    # Free-form remarks: glare, cropped corners, suspected tampering, etc.
    notes: str | None = None


class IdReread(BaseModel):
    """The targeted second read of one document's Israeli ID number (Anthropic backend):
    asked only when the card and the sefach on a page disagree — read from its own crop,
    the spaced number comes back with its flanking digits swapped, about one read in six
    into a number that even passes the check digit. Digits as printed, spaces allowed."""

    id_number: str | None


class AnthropicPageExtraction(DocumentExtraction):
    """First-pass schema on the Anthropic backend (whole image, no detection stage).

    The page may hold a sefach sheet next to the primary document (a typical A4 scan:
    card + sefach); `document_type` then names the card, so the sefach needs its own
    flag to trigger the SefachExtraction follow-up parse. Never part of the API shape —
    `to_document_extraction`-style narrowing drops the flag."""

    # True when the paper appendix (ספח: blue guilloche sheet with address, marital
    # status and child blocks) is visible anywhere on the page, alone or beside a card.
    sefach_present: bool


CHEQUE_TYPES = frozenset({"cheque", "cheque_back"})


class ChequeExtraction(BaseModel):
    """Israeli bank cheque — the API shape and the Anthropic structured-output schema.

    `cheque` = the front (or front + back merged), `cheque_back` = only the back is
    visible. Printed details come from the header and the reference line printed above
    the payee line ("<cheque> <bank> <branch+2> <account>"); the MICR line at the bottom
    repeats them and is transcribed raw for cheque_check to parse. Booleans are presence
    checks (no confidence). Never invent handwriting: unreadable = null.
    """

    document_type: Literal["cheque", "cheque_back", "other", "unreadable"]
    # Printed bank details (front)
    bank_name: ExtractedField  # Hebrew as printed: דיסקונט / לאומי / בנק הפועלים
    bank_code: ExtractedField  # 2 digits
    branch_number: ExtractedField  # 3 digits
    account_number: ExtractedField
    cheque_number: ExtractedField
    # Printed account holder (header)
    drawer_name: ExtractedField  # person or company, Hebrew as printed
    drawer_id_number: ExtractedField  # ת.ז. or ח.פ., 9 digits
    drawer_address: ExtractedField
    drawer_phone: ExtractedField
    # Handwritten (front)
    payee: ExtractedField  # שלמו ל
    amount: ExtractedField  # figures as written; postprocess -> "4500.00"
    amount_in_words: ExtractedField  # Hebrew as written
    date: ExtractedField  # ISO YYYY-MM-DD
    payee_only: bool | None  # "למוטב בלבד" crossing present
    signed: bool | None  # signature present on the front
    # Back: personal-guarantee stamp («אני ___ בעל ת.ז. ___ ערב ערבות אישית ... חתימה ___»)
    guarantor_name: ExtractedField
    guarantor_id_number: ExtractedField  # 9 digits
    guarantor_signed: bool | None
    # Raw MICR line at the bottom of the front, as printed; separator glyphs in any form.
    # Required-but-nullable like mrz_lines so the model must look for it.
    micr_line: str | None
    notes: str | None = None


# What `model_dump(exclude=...)` drops when a DocumentExtraction/ChequeExtraction becomes
# the API's flat `fields` dict: document_type is reported alongside `fields`, not inside
# it, mrz_lines/micr_line are transcript-only, notes is folded into `warnings`. Shared
# between pipeline.py's live `read` event and main.py's final response so the two can
# never drift apart — the live ledger's fields must have the same shape as the result
# that replaces it (see "Duplicated field-exclusion sets" in the final-wave review).
IDENTITY_FIELDS_EXCLUDE = {"document_type", "mrz_lines", "notes"}
CHEQUE_FIELDS_EXCLUDE = {"document_type", "micr_line", "notes"}


class SefachPerson(BaseModel):
    """A spouse or child listed on the sefach. Plain strings (one confidence per
    person) keep the schema small enough for local models."""

    last_name_he: str | None
    first_name_he: str | None
    id_number: str | None  # 9 digits
    date_of_birth: str | None  # ISO YYYY-MM-DD (children only; spouse block has no date)
    sex: str | None  # "M" / "F" (children only)
    confidence: Confidence


class SefachAddress(BaseModel):
    """The מען block of the holder."""

    street: str | None
    house_number: str | None
    entrance: str | None  # כניסה
    apartment: str | None  # מס' דירה
    city: str | None  # הישוב
    postal_code: str | None  # מיקוד
    confidence: Confidence


class SefachExtraction(BaseModel):
    """Structured-output schema for the paper appendix (ספח לתעודת זהות).

    Covers both layouts: the current sheet (holder block + address, previous
    names, marital status, spouse, child blocks) and the older single-page
    sefach that also printed parents' names, birth date and place of birth.
    Fields a layout does not carry must come back null.
    """

    document_type: Literal["teudat_zehut_sefach", "other"]
    # Holder block
    id_number: ExtractedField
    last_name_he: ExtractedField
    first_name_he: ExtractedField
    previous_last_name_he: ExtractedField  # שם המשפחה הקודם
    previous_first_name_he: ExtractedField  # השם הפרטי הקודם
    maiden_name_he: ExtractedField  # שם נעורים
    father_name_he: ExtractedField  # שם האב (old layout only)
    mother_name_he: ExtractedField  # שם האם (old layout only)
    date_of_birth: ExtractedField  # ISO, old layout only
    place_of_birth: ExtractedField  # old layout only — never the address city
    marital_status: ExtractedField  # Hebrew as printed: רווק/נשוי/גרוש/אלמן (+ feminine forms)
    nationality: ExtractedField  # אזרחות, old layout only (Hebrew as printed, e.g. ישראלית)
    date_of_issue: ExtractedField  # ניתן ב- (ISO)
    address: SefachAddress | None
    spouse: SefachPerson | None
    children: list[SefachPerson]
    notes: str | None = None


# Per-block schemas for the current sefach sheet (a 2x4 grid of blocks). Small
# schemas on tight crops read far better with local models than one big schema
# on the whole sheet; assemble.py assembles them into a SefachExtraction.

# Block schemas are flat — plain strings plus ONE confidence per block. Per-field
# {value, confidence} wrappers nearly doubled the generated tokens (159 vs 94 for
# the holder block) for identical values; generation speed is the bottleneck.

class SefachHolderBlock(BaseModel):
    """Top-right block: holder identity, address, issue date."""

    id_number: str | None  # 9 digits
    last_name_he: str | None
    first_name_he: str | None
    street: str | None
    house_number: str | None
    entrance: str | None  # כניסה
    apartment: str | None  # מס' דירה
    city: str | None  # הישוב
    postal_code: str | None  # מיקוד
    date_of_issue: str | None  # ISO YYYY-MM-DD
    confidence: Confidence


class SefachStatusBlock(BaseModel):
    """Top-left block: previous names, marital status, spouse."""

    id_number: str | None
    previous_last_name_he: str | None
    previous_first_name_he: str | None
    maiden_name_he: str | None
    marital_status: str | None  # Hebrew as printed
    spouse_id_number: str | None
    spouse_last_name_he: str | None
    spouse_first_name_he: str | None
    confidence: Confidence


class SefachOldTopBlock(BaseModel):
    """Older single-page sefach, upper part: holder identity and address."""

    id_number: str | None  # 9 digits
    last_name_he: str | None
    first_name_he: str | None
    street: str | None
    house_number: str | None
    apartment: str | None
    city: str | None  # הישוב
    postal_code: str | None
    confidence: Confidence


class SefachOldBottomBlock(BaseModel):
    """Older single-page sefach, lower part: marital status, spouse, nationality, previous names."""

    marital_status: str | None  # Hebrew as printed
    spouse_id_number: str | None
    spouse_name_he: str | None  # one printed line (שם בן/בת הזוג), kept whole
    nationality_he: str | None  # אזרחות
    maiden_name_he: str | None
    previous_last_name_he: str | None
    previous_first_name_he: str | None
    confidence: Confidence


class SefachChildBlock(BaseModel):
    """One ילד/ילדה block. The first printed number is the holder's ID, not the child's."""

    holder_id_number: str | None
    child: SefachPerson


class ChequeDrawerBlock(BaseModel):
    """The account holder's printed block cut from the top corner of a cheque front, read
    on its own crop (the whole-front read leaves it empty on most cheques and copies the
    branch's address and phone into it on others). Flat like the Ollama-facing schemas:
    plain strings plus one uncertain_fields list."""

    drawer_name: str | None  # person or company, Hebrew as printed
    drawer_id_number: str | None  # ת.ז. or ח.פ., 9 digits
    drawer_address: str | None
    drawer_phone: str | None
    uncertain_fields: list[Literal["drawer_name", "drawer_id_number", "drawer_address", "drawer_phone"]]


class Region(BaseModel):
    """One document found on the page by the detection pass."""

    label: Literal[
        "id_card_front",
        "id_card_back",
        "sefach",
        "passport",
        "drivers_license",
        "cheque_front",
        "cheque_back",
        "other_document",
    ]
    # [x1, y1, x2, y2] normalized to 0-1000 of image width/height
    bbox_2d: list[int]


class RegionDetection(BaseModel):
    regions: list[Region]


class FrameClass(BaseModel):
    """Stage 3a output: which accepted document one frame shows, or none, and whether that
    is certain. Two fields on purpose — the answer is ~15 output tokens. Vocabulary mirrored
    in doctypes.FRAME_KINDS. A sure kind chooses the reading schema (doctypes.KIND_TO_LABEL);
    an unsure one leaves the detector's label in charge."""

    kind: Literal[
        "teudat_zehut", "teudat_zehut_back", "sefach", "israeli_passport", "foreign_passport",
        "drivers_license", "senior_citizen_card", "disability_card", "weapon_license",
        "cheque_front", "cheque_back", "none",
    ]
    sure: bool


class TranscribedLines(BaseModel):
    """Stage-A output: raw text lines of one document, top to bottom."""

    lines: list[str]


class RegionResult(BaseModel):
    label: str
    bbox_2d: list[int]
    document_type: str
    dpi: int | None = None  # estimated source resolution (app/resolution.py); None = unknown


class CrossCheck(BaseModel):
    field: str
    visual: str | None = None
    reference: str | None = None  # the machine-read value: MRZ for identity documents, MICR / amount in words for cheques
    match: bool


class ValidationReport(BaseModel):
    mrz_present: bool = False
    mrz_checksums_valid: bool | None = None
    id_number_checksum_valid: bool | None = None
    # Cheques: the MICR line plays the MRZ's role (see cheque_check.py)
    micr_present: bool = False
    micr_parsed: bool = False
    guarantor_id_checksum_valid: bool | None = None
    guarantor_is_drawer: bool | None = None  # informational — self-guarantee is normal
    cross_checks: list[CrossCheck] = []
    overall: Literal["verified", "partial", "unverified", "mismatch"] = "unverified"


class CallUsageOut(BaseModel):
    """Token counts of one model call, for the caller's accounting. Counts only."""
    backend: str
    model: str
    schema_name: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int


class ExtractionResponse(BaseModel):
    document_type: str
    fields: dict
    validation: ValidationReport
    warnings: list[str] = []
    regions: list[RegionResult] = []
    # Contents of the paper appendix when one was found on the page: address,
    # previous names, marital status (+ a normalized `marital_status_code`),
    # spouse and children. Null when no sefach is present.
    sefach: dict | None = None
    model: str
    usage: list[CallUsageOut] = []


class ModelInfo(BaseModel):
    """One entry of config.LOCAL_MODELS plus whether Ollama has it pulled."""

    id: str
    label: str
    note: str
    installed: bool


class ModelsResponse(BaseModel):
    """GET /models: what the settings page offers as the local model, and which model each
    backend runs when a request names none. Both defaults travel, not just the running
    backend's: the web app's backend switch can pick the other one."""

    backend: str
    default_local: str
    default_cloud: str
    ollama_reachable: bool
    models: list[ModelInfo]
