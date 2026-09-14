"""Values the transcript can prove, independent of what the model answered.

The transcript is the trusted source wherever it can be: a family name printed above its
label, an ID whose check digit validates, a sex word next to the Hebrew or Arabic label,
parents in the order the old laminated card prints them. Asked from the 8B model directly,
these come back shifted or swapped; read off the transcribed lines they are stable.

Pure string work. Nothing here opens an image or calls a model.
"""

import difflib
import re

from .mrz_check import israeli_id_checksum_valid

_NIQQUD = re.compile(r"[\u0591-\u05C7]")
_HEBREW_ONLY = re.compile(r"^[\u05D0-\u05EA][\u05D0-\u05EA\s'\"\u05F3\u05F4-]{0,24}$")

# Hebrew name fields are Hebrew by definition (the model must never transliterate, and
# every label on an Israeli document is printed in Arabic too).
_HEBREW_NAME_FIELDS = ("last_name_he", "first_name_he")

# Transcribed label lines are noisy ("שם התשלומה" for "שם המשפחה"); match them fuzzily.
_LABELS = {"last_name_he": ["שםהמשפחה", "שםמשפחה"], "first_name_he": ["השםהפרטי", "שםפרטי"]}

# Fields a document type carries only on some of its layouts: the old laminated teudat
# zehut prints המין and מקום הלידה, the biometric front prints neither and the model would
# invent them. They survive postprocess only when their label is in the transcript.
# Every label is printed in Hebrew with its Arabic twin; on a photocopy the Hebrew often
# transcribes garbled while the Arabic comes out clean (or the other way round), so both
# count. Hebrew cores match fuzzily (long ones) or exactly (short ones: שםהאב vs שםהאם are
# one letter apart), Arabic cores always exactly (اسمالأب vs اسمالأم likewise).
GATED_BY_LABEL = {"teudat_zehut": {
    "sex": ["המין", "الجنس"], "place_of_birth": ["מקוםהלידה", "מקוםלידה", "مكانالولادة"],
    "father_name_he": ["שםהאב", "اسمالأب"], "mother_name_he": ["שםהאם", "اسمالأم"],
}}
_LABEL_MATCH = 0.75
_LABEL_EXACT_UPTO = 5  # Hebrew cores this short must match exactly

# The printed sex word, Hebrew or the Arabic beside it (the model often transcribes the
# Arabic, sometimes misspelt: زكر for ذكر).
_SEX_WORDS = {"זכר": "M", "נקבה": "F", "ذكر": "M", "زكر": "M", "أنثى": "F", "انثى": "F", "أنثي": "F"}


def strip_niqqud(value: str | None) -> str | None:
    return _NIQQUD.sub("", value).strip() if value else value


def _hebrew_core(text: str) -> str:
    return "".join(ch for ch in text if "\u05D0" <= ch <= "\u05EA")


def anchor_names(lines: list[str]) -> dict:
    """Find name values by their printed labels in a top-to-bottom transcript.

    The first-name label (השם הפרטי) transcribes reliably; the family-name label
    is often garbled, but on every Israeli ID layout the family name is printed
    directly ABOVE the first-name label. Deterministic, model-independent."""

    def name_like(text: str | None) -> str | None:
        candidate = strip_niqqud(text or "")
        return candidate if candidate and _HEBREW_ONLY.match(candidate) else None

    best_idx, best_score = -1, 0.0
    for idx, line in enumerate(lines):
        core = _hebrew_core(line)
        if len(core) < 4:
            continue
        score = max(difflib.SequenceMatcher(None, core, v).ratio() for v in _LABELS["first_name_he"])
        if score > best_score:
            best_idx, best_score = idx, score
    if best_score < 0.6:
        return {}
    found: dict = {}
    first = name_like(lines[best_idx + 1]) if best_idx + 1 < len(lines) else None
    if first:
        found["first_name_he"] = first
    last = name_like(lines[best_idx - 1]) if best_idx >= 1 else None
    if last:
        found["last_name_he"] = last
    return found


def _arabic_core(text: str) -> str:
    return "".join(ch for ch in text if "\u0621" <= ch <= "\u064A")


def _has_label(lines: list[str], variants: list[str]) -> bool:
    hebrew = [v for v in variants if _hebrew_core(v)]
    arabic = [v for v in variants if _arabic_core(v)]
    for line in lines:
        core = _hebrew_core(line)
        if len(core) >= 3 and hebrew:
            if len(core) <= _LABEL_EXACT_UPTO:
                if core in hebrew:
                    return True
            elif max(difflib.SequenceMatcher(None, core, v).ratio() for v in hebrew) >= _LABEL_MATCH:
                return True
        if arabic and _arabic_core(line) in arabic:
            return True
    return False


# The printed "valid until" label. Deliberately NOT in GATED_BY_LABEL: that table drives the
# gate that nulls a field whose label is missing, and a transcript that failed would then cost
# a biometric card the expiry it really prints. This label only ever ADDS information — that
# this particular card carries a validity date — and postprocess reads it that way.
# Hebrew only: the Arabic twin sits beneath it on the card but is too small to transcribe
# reliably on the one sample, and an Arabic core has to match exactly to be worth having.
# Three spellings because the word alone carries the meaning and the עד does not survive
# transcription: measured on the card that prints it (8B, 2026-09-11), the label comes back
# as "בְּתֹקֶף" — niqqud, the defective spelling, no עד — whose core is the 4-letter "בתקף".
# Every variant here is at or under _LABEL_EXACT_UPTO or close to it, so they match exactly
# or near-exactly and cannot be reached by an unrelated word.
_VALIDITY_LABEL = ["בתוקףעד", "בתוקף", "בתקף"]


def anchor_labels(lines: list[str]) -> set[str]:
    """Which layout-dependent fields the transcript shows a printed label for, plus
    `date_of_expiry` when the card prints בתוקף עד — see `_VALIDITY_LABEL`."""
    found = {field for gated in GATED_BY_LABEL.values() for field, variants in gated.items() if _has_label(lines, variants)}
    if _has_label(lines, _VALIDITY_LABEL):
        found.add("date_of_expiry")
    return found


# Label cores that may sit between a group's labels and its values on the old laminated
# card; they are Hebrew-only and would otherwise pass for a name.
_OLD_CARD_LABEL_CORES = {"שםהמשפחה", "השםהפרטי", "שםהפרטי", "שםהאב", "שםהאם", "תאריךהלידה", "מקוםהלידה", "המין", "ניתנהב", "ניתןב"}


def anchor_parents(lines: list[str], with_holder: bool = False) -> dict:
    """Father's and mother's names from the old laminated card's transcript.

    That card prints its labels in groups and the values below in the same order —
    שם המשפחה / השם הפרטי / שם האב, then family name, first name, father; שם האם /
    תאריך הלידה / מקום הלידה, then mother, date, place (stable 3/3 transcriptions) — and
    the model shifts the parents by one line when asked for them (2/2). So: the father
    is the third of the three name-like lines that follow the שם האב label (or the only
    one, on a label/value interleaved layout); the mother is the first name-like line
    after the שם האם label that is not itself a label. ``with_holder`` also returns the
    family and first names from the same three-line run."""
    def name_like(text: str) -> str | None:
        candidate = strip_niqqud(text)
        return candidate if candidate and _HEBREW_ONLY.match(candidate) and _hebrew_core(candidate) not in _OLD_CARD_LABEL_CORES else None

    def label_at(core: str) -> int | None:
        return next((i for i, line in enumerate(lines) if _hebrew_core(line) == core), None)

    found: dict = {}
    father_label = label_at("שםהאב")
    if father_label is not None:
        run: list[str] = []
        for line in lines[father_label + 1:]:
            value = name_like(line)
            if value:
                run.append(value)
            elif run or _hebrew_core(line):  # a non-name after the run, or a Hebrew label: the run is over
                break
        if len(run) >= 3:
            found["father_name_he"] = run[2]
            if with_holder:
                found["last_name_he"], found["first_name_he"] = run[0], run[1]
        elif len(run) == 1:
            found["father_name_he"] = run[0]
    mother_label = label_at("שםהאם")
    if mother_label is not None:
        mother = next((name_like(line) for line in lines[mother_label + 1:] if name_like(line)), None)
        if mother:
            found["mother_name_he"] = mother
    if "mother_name_he" not in found and father_label is not None and len(run) >= 4:
        # No usable שם האם label (a photocopy dropped it) but the values kept their order:
        # family name, first name, father, mother.
        found["mother_name_he"] = run[3]
    return found


_ID_LINE = re.compile(r"(?<!\d)(\d)[\s-]?(\d{7})[\s-]?(\d)(?!\d)")


def anchor_id(lines: list[str]) -> str | None:
    """The 9-digit ID as printed ("1 2345678 2"), from the first transcript line that
    holds one whose check digit is valid. The model swaps the flanking digits of the
    spaced number often enough (sefach holder block 3/3, a tilted card 2/2) that the
    transcript line, check-digit-validated, is the safer source."""
    for line in lines:
        for m in _ID_LINE.finditer(line):
            digits = "".join(m.groups())
            if israeli_id_checksum_valid(digits):
                return digits
    return None


# The printed reference line of a cheque: "<cheque number> <bank 2 digits> <branch 3 + 2>
# <account>", four whitespace-separated digit groups with exactly that middle shape. The
# MICR line as the transcriber reads it usually lacks the bank group and so never matches.
_REFERENCE_LINE = re.compile(r"(?<!\d)\d{5,10}\s+(\d{2})\s+(\d{5})\s+\d{5,12}(?!\d)")
_BRANCH_DIGITS = 3


def anchor_cheque_reference(lines: list[str]) -> dict[str, str]:
    """bank_code and branch_number from the first transcript line printed as a reference
    line. The model copies the prompt example's bank and branch into these two fields
    (and into its MICR line) when the cheque is not from the example's bank — a Leumi
    cheque came back as bank 11, branch 148 with "10 93411" plainly in the transcript,
    and so did two of the samples; the transcript's reading of that short group was right
    on every sample that has it. Only those two fields: the cheque and account numbers
    are never copied from the example, and on a faxed sample the transcript misread the
    first digit of the cheque number where the model and the MICR line agreed. Empty
    when no line matches."""
    for line in lines:
        m = _REFERENCE_LINE.search(strip_niqqud(line))
        if m:
            return {"bank_code": m.group(1), "branch_number": m.group(2)[:_BRANCH_DIGITS]}
    return {}


def anchor_sex(lines: list[str]) -> str | None:
    """M/F when the transcript has both the המין label and a line that IS a sex word.
    Deterministic, model-independent — the card's sex is never taken from the model."""
    if not _has_label(lines, GATED_BY_LABEL["teudat_zehut"]["sex"]):
        return None
    for line in lines:
        code = _SEX_WORDS.get(strip_niqqud(line).strip())
        if code:
            return code
    return None


# Printed titles that name the document type outright. The classifier's thumbnail takes
# the disabled-veteran card (blue, photo, no chip) for a teudat zehut — the 30B MoE 2/2,
# sure — and the card's own fields (file_number, the Latin names, the MM.YYYY expiry)
# then have no schema to land in. The title is printed large on the card; the transcript
# has it whenever the card is readable at all.
_TYPE_TITLES = {"disability_card": ["תעודתנכה", "תעודתנכהצהל"]}

# The one title anchor_type must be ranked against. The ID card's own title, "תעודת
# זהות", shares a five-character prefix with the disability card's ("תעודת"): a single
# dropped or confused letter in either can score above `_LABEL_MATCH` against the
# other — the same photocopy transcription noise this module already lives with
# (המין -> המונ). anchor_type never returns "teudat_zehut" itself (that type needs no
# anchor, it is the default); this entry exists so that a corrupted ID-card title is
# ranked against the title it really is. What that buys, exactly: of every one-letter
# corruption of "תעודת זהות" (each position dropped, and each replaced by any Hebrew
# letter) not one outscores it — the score rule rejects all of them. A more corrupted
# line still can (e.g. a core "תעודתנכות" scores 0.824 against this title's 0.778), so
# the anchor has a second, independent guard downstream: `_extract_fields_ollama` keeps
# the anchored type over the model's own document_type only when the read came back with
# a `file_number`, and otherwise redoes the read as if no title had been found.
_COMPETING_TITLES = {"teudat_zehut": ["תעודתזהות"]}


def _title_score(lines: list[str], variants: list[str]) -> float:
    """The best fuzzy match of any line's Hebrew core against any of these title
    variants, using the same core-length rule as `_has_label` (exact for a short core,
    fuzzy above `_LABEL_EXACT_UPTO`) — but a score, not a bool, so competing titles can
    be ranked against each other rather than just checked for presence."""
    hebrew = [v for v in variants if _hebrew_core(v)]
    if not hebrew:
        return 0.0
    best = 0.0
    for line in lines:
        core = _hebrew_core(line)
        if len(core) < 3:
            continue
        if len(core) <= _LABEL_EXACT_UPTO:
            if core in hebrew:
                best = max(best, 1.0)
        else:
            best = max(best, max(difflib.SequenceMatcher(None, core, v).ratio() for v in hebrew))
    return best


def anchor_type(lines: list[str]) -> str | None:
    """A document type named by a printed title in the transcript, else None.

    Only ever returns "disability_card" — picked by score, not by presence alone, so a
    transcript whose best match is actually (or ties) the competing ID-card title never
    mislabels it: the title alone is not enough evidence on its own, only the highest-
    scoring one is.

    The match is per transcript LINE, on that line's whole Hebrew core: a title the
    transcription merged with a neighbouring heading into one line (the title plus the
    issuing ministry's name, say) has a core far longer than any variant, scores below
    `_LABEL_MATCH` and simply does not fire — the anchor fails safe, to no anchor."""
    best_type, best_score = None, 0.0
    for doc_type, variants in _TYPE_TITLES.items():
        score = _title_score(lines, variants)
        if score > best_score:
            best_type, best_score = doc_type, score
    if best_score < _LABEL_MATCH:
        return None
    competing_score = max((_title_score(lines, variants) for variants in _COMPETING_TITLES.values()), default=0.0)
    if competing_score >= best_score:
        return None
    return best_type
