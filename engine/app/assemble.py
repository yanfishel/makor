"""Stage 5c: several documents on one page become one result.

merge combines regions by priority, card first. A region whose ID differs from the primary
is a different person and is skipped. A sefach or a card back may only fill gaps, never
override and never raise a conflict: the card face is authoritative. The predicates the
sefach rescue needs live here too, so they stay testable without a model.
"""

import copy
import difflib
from typing import Literal

from .doctypes import CHEQUE_CARRIED, FIELDS, PRIORITY, SECONDARY_TYPES
from .mrz_check import israeli_id_checksum_valid
from .postprocess import assemble_sefach, marital_status_code, postprocess_sefach
from .schemas import (
    ChequeExtraction,
    DocumentExtraction,
    ExtractedField,
    SefachExtraction,
    SefachHolderBlock,
)


def sefach_payload(sefach: SefachExtraction) -> dict:
    """Response shape: the model output plus a normalized marital-status code."""
    payload = sefach.model_dump(exclude={"document_type"})
    payload["marital_status_code"] = marital_status_code(sefach.marital_status.value)
    return payload


def sefach_holder_verdict(sefach: SefachExtraction, card: DocumentExtraction | None) -> Literal["names", "unread", "other"]:
    """Whose sheet this is, once its holder ID has already disagreed with the card.

    `names` — both names match, so the number is a misread of the holder's own (the ID on a
    sefach block is the one field the 8B model swaps most, and a 100 dpi sheet gives it no
    chance). `unread` — the sheet's own names did not come back at all, so nothing contradicts
    the card either: the sheet is kept with a warning rather than thrown away with its address
    and children (measured 2026-09-12). `other` — the names were read and are somebody
    else's."""
    if card is None:
        return "unread"
    if _same_holder_by_name(sefach, card):
        return "names"
    theirs = (sefach.first_name_he.value, sefach.last_name_he.value)
    ours = (card.first_name_he.value, card.last_name_he.value)
    return "other" if all(theirs) and all(ours) else "unread"


def select_sefach(candidates: list[SefachExtraction], card: DocumentExtraction | None) -> tuple[SefachExtraction | None, list[str]]:
    """Keep the sefach that belongs to the primary document's holder.

    A sefach whose holder ID differs from the card is only another person's paper when its
    own names say so (`sefach_holder_verdict`); a misread ID is reconciled before this runs
    (`match_sefach_by_name`) or, failing that, here, against the names."""
    warnings: list[str] = []
    chosen: SefachExtraction | None = None
    primary_id = card.id_number.value if card is not None else None
    for sefach in candidates:
        theirs = sefach.id_number.value
        if primary_id and theirs and _norm(primary_id) != _norm(theirs):
            verdict = sefach_holder_verdict(sefach, card)
            if verdict == "other":
                warnings.append("Ignored a sefach belonging to a different person (ID number differs)")
                continue
            if verdict == "names":
                sefach = sefach.model_copy(deep=True)
                sefach.id_number = ExtractedField(value=primary_id, confidence="medium")
                warnings.append("Sefach ID number differs from the card, but both names match: kept, with the card's number")
            else:
                sefach = sefach.model_copy(deep=True)
                sefach.id_number = ExtractedField(value=theirs, confidence="low")  # it contradicts the card
                warnings.append(
                    "Sefach ID number differs from the card and the sheet's own names were not read: "
                    "kept as it is — check that it belongs to this person"
                )
        if chosen is None:
            chosen = sefach
        else:
            warnings.append("Several sefach regions found — only the first was kept")
    if chosen is None:
        return None, warnings
    for i, child in enumerate(chosen.children, start=1):
        if child.id_number and israeli_id_checksum_valid(child.id_number) is False:
            warnings.append(f"Sefach: child #{i} ID number failed its check-digit test")
    if chosen.spouse and chosen.spouse.id_number and israeli_id_checksum_valid(chosen.spouse.id_number) is False:
        warnings.append("Sefach: spouse ID number failed its check-digit test")
    return chosen, warnings


# --------------------------------------------------------------------------- sefach guard
#
# The card on the same page is ground truth for the sefach's holder: its ID number is
# check-digit-validated and read from a crisp card face, while the 8B model reads the
# sefach's holder block chaotically — on the same sheet a few pixels of crop difference
# swap the ID's flanking digits or push the street name into the first-name field
# (measured 2026-09-07, docs/engine-pipeline.md §6). Re-reading the block with another cell margin is a
# fresh sample; the card decides whether to accept it.


# How alike two last names must be to pass for one: a single misread letter in a name
# of six or more (מיכלזון read as מייזלזון on a sefach crop) — the first name must match
# exactly, so this is a one-letter tolerance on top of an exact match, not fuzzy identity.
_LAST_NAME_MIN_RATIO = 0.8


def accept_reread_ids(
    sefach: SefachExtraction, card: DocumentExtraction, card_id: str | None, sefach_id: str | None,
) -> tuple[SefachExtraction, ExtractedField] | None:
    """After a targeted re-read of both IDs (Anthropic backend, on a disagreement): the
    number both crops now agree on, if it passes its check digit, is the printed one.
    Returns the sefach with that ID and the ID field the card should carry — each at
    medium where the re-read changed the first read, unchanged where it confirmed it.
    None when the re-reads still differ or the agreed number fails the check digit."""
    if not (card_id and sefach_id) or not _same_id(card_id, sefach_id) or not israeli_id_checksum_valid(card_id):
        return None
    card_field = card.id_number if _same_id(card.id_number.value, card_id) else ExtractedField(value=card_id, confidence="medium")
    fixed = sefach
    if not _same_id(sefach.id_number.value, card_id):
        fixed = sefach.model_copy(deep=True)
        fixed.id_number = ExtractedField(value=card_id, confidence="medium")
    return fixed, card_field


def match_sefach_by_name(sefach: SefachExtraction, card: DocumentExtraction) -> tuple[SefachExtraction, ExtractedField] | None:
    """The holder's own sefach whose ID (or the card's) came back misread, or None.
    Read from its own crop, a spaced ID comes back with its flanking digits swapped —
    the 8B model on every sefach holder block (hence rescue_sefach), Claude on 2 of 22
    samples once it reads per region, on the card crop as often as on the sefach's. A
    differing ID that FAILS its check digit is a misread, not a person, so the names
    decide, the way `holder_reread_verdict` accepts a re-read holder block. Returns the
    sefach to keep and the ID field the card should carry: the check-digit-valid side's
    number, at medium on whichever side was corrected (the card's own when both fail).
    Two valid IDs that differ stay two people, whatever the names say."""
    theirs, ours = sefach.id_number.value, card.id_number.value
    if not (theirs and ours) or _same_id(theirs, ours):
        return None
    theirs_ok, ours_ok = israeli_id_checksum_valid(theirs), israeli_id_checksum_valid(ours)
    if (theirs_ok and ours_ok) or not _same_holder_by_name(sefach, card):
        return None
    if ours_ok or not theirs_ok:
        fixed = sefach.model_copy(deep=True)
        fixed.id_number = ExtractedField(value=ours, confidence="medium")
        return fixed, card.id_number
    return sefach, ExtractedField(value=theirs, confidence="medium")


def _same_holder_by_name(sefach: SefachExtraction, card: DocumentExtraction) -> bool:
    first = (sefach.first_name_he.value, card.first_name_he.value)
    last = (sefach.last_name_he.value, card.last_name_he.value)
    if not all(first) or not all(last) or _norm(first[0]) != _norm(first[1]):
        return False
    return difflib.SequenceMatcher(None, _norm(last[0]), _norm(last[1])).ratio() >= _LAST_NAME_MIN_RATIO


def _same_id(a: str | None, b: str | None) -> bool:
    return bool(a and b and a.lstrip("0") == b.lstrip("0"))


def sefach_needs_rescue(sefach: SefachExtraction, card: DocumentExtraction) -> bool:
    """True when the holder block contradicts the card (ID differs) or shows the known
    shift signature (first name == street). Without a card ID there is nothing to
    compare against."""
    card_id = card.id_number.value
    theirs = sefach.id_number.value
    if card_id and theirs and not _same_id(card_id, theirs):
        return True
    first, street = sefach.first_name_he.value, sefach.address.street if sefach.address else None
    return bool(card_id and first and street and _norm(first) == _norm(street))


def holder_reread_verdict(holder: SefachHolderBlock, card: DocumentExtraction) -> Literal["id", "names"] | None:
    """How a re-read holder block is accepted: by its ID matching the card, or by both
    names matching the card (the ID is then the card's). None = rejected."""
    if _same_id(holder.id_number, card.id_number.value):
        return "id"
    names = ((holder.last_name_he, card.last_name_he.value), (holder.first_name_he, card.first_name_he.value))
    if all(a and b and _norm(a) == _norm(b) for a, b in names):
        return "names"
    return None


def apply_holder_block(sefach: SefachExtraction, holder: SefachHolderBlock, card: DocumentExtraction,
                       verdict: Literal["id", "names"]) -> SefachExtraction:
    """A copy of ``sefach`` with the holder-derived fields (identity, address, issue date)
    replaced by the re-read block; the other blocks are untouched. The ID is the card's,
    at medium confidence: it was disputed once."""
    fixed = sefach.model_copy(deep=True)
    fresh = assemble_sefach(holder, None, [])
    for name in ("last_name_he", "first_name_he", "date_of_issue"):
        setattr(fixed, name, getattr(fresh, name))
    fixed.address = fresh.address
    fixed.id_number = ExtractedField(value=card.id_number.value, confidence="medium")
    return postprocess_sefach(fixed)


def reconcile_sefach_names(sefach: SefachExtraction, card: DocumentExtraction) -> tuple[SefachExtraction, list[str]]:
    """The card face is authoritative for the holder's names: a sefach name that is a
    strict prefix of the card's (the 8B model drops the last letter of a printed name —
    6/6 runs on the old-layout sample) is replaced by the card's at medium confidence."""
    warnings: list[str] = []
    fixed = sefach
    for name in ("last_name_he", "first_name_he"):
        theirs, ours = getattr(sefach, name).value, getattr(card, name).value
        if theirs and ours and theirs != ours and ours.startswith(theirs):
            if fixed is sefach:
                fixed = sefach.model_copy(deep=True)
            setattr(fixed, name, ExtractedField(value=ours, confidence="medium"))
            warnings.append(f"Sefach {name} was cut short by the model and taken from the card")
    return fixed, warnings


def merge_cheque(results: list[ChequeExtraction]) -> tuple[ChequeExtraction | None, list[str]]:
    """First front + first back; the back contributes only its own fields. Extra sides
    are ignored with a warning. Only a back -> the back itself (document_type cheque_back)."""
    fronts = [c for c in results if c.document_type == "cheque"]
    backs = [c for c in results if c.document_type == "cheque_back"]
    warnings = []
    if len(fronts) > 1:
        warnings.append("Ignored a second cheque front on the page")
    if len(backs) > 1:
        warnings.append("Ignored a second cheque back on the page")
    if not fronts and not backs:
        return None, warnings
    if not fronts:
        return backs[0].model_copy(deep=True), warnings
    merged = fronts[0].model_copy(deep=True)
    if backs:
        back = backs[0]
        for name in CHEQUE_CARRIED["cheque_back"]:
            setattr(merged, name, copy.deepcopy(getattr(back, name)))
        if back.notes:
            merged.notes = f"{merged.notes}; {back.notes}" if merged.notes else back.notes
    return merged, warnings


def _norm(value: str) -> str:
    return "".join(ch for ch in value if ch.isalnum()).lower()


def merge(results: list[DocumentExtraction]) -> tuple[DocumentExtraction, list[str]]:
    ranked = sorted(results, key=lambda r: PRIORITY.index(r.document_type))
    primary = ranked[0].model_copy(deep=True)
    warnings: list[str] = []
    for other in ranked[1:]:
        # A different ID number means a different person (child/spouse block on a
        # sefach, or a second document on the page) — do not mix their fields in.
        mine_id, theirs_id = primary.id_number.value, other.id_number.value
        if mine_id and theirs_id and _norm(mine_id) != _norm(theirs_id):
            warnings.append(
                f"Ignored a {other.document_type} block belonging to a different person (ID number differs)"
            )
            continue
        # Secondary paper (sefach, card back) is less reliable than the card/passport
        # face itself: it may only fill gaps, its disagreements are not worth a warning.
        fill_only = other.document_type in SECONDARY_TYPES
        for name in FIELDS:
            mine: ExtractedField = getattr(primary, name)
            theirs: ExtractedField = getattr(other, name)
            if not theirs.value:
                continue
            if not mine.value:
                setattr(primary, name, theirs)
            elif fill_only:
                continue
            elif _norm(mine.value) != _norm(theirs.value):
                if mine.confidence != "high" and theirs.confidence == "high":
                    setattr(primary, name, theirs)
                warnings.append(f"{name} differs between {primary.document_type} and {other.document_type}")
        if not primary.mrz_lines and other.mrz_lines:
            primary.mrz_lines = other.mrz_lines
        if other.notes and not fill_only:
            primary.notes = f"{primary.notes}; {other.notes}" if primary.notes else other.notes
    return primary, list(dict.fromkeys(warnings))  # dedupe, keep order
