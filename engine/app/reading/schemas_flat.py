"""The model-facing schemas, narrower than the API ones on purpose.

A flat schema saves about nine output tokens per field by dropping the per-field
confidence wrapper, and a per-type schema drops the fields that type cannot carry. A wide
flat schema silently loses fields a typed schema reads, which is why the reverse re-read
exists: when a value is missing, try the narrower schema before blaming the document.
"""

from typing import Literal, TypeVar

from pydantic import BaseModel, create_model

from ..doctypes import CARRIED_FIELDS, CHEQUE_CARRIED, MRZ_TYPES
from ..schemas import ChequeExtraction, DocumentExtraction, ExtractedField
from .prompts import DISABILITY_CARD_HINT

T = TypeVar("T", bound=BaseModel)


_CHEQUE_PHRASE = {"cheque": " of this cheque front", "cheque_back": " of this cheque back"}


_TYPE_PHRASE = {
    "teudat_zehut": " of this teudat zehut front",
    "teudat_zehut_back": " of this teudat zehut back",
    "israeli_passport": " of this passport",
    "foreign_passport": " of this foreign passport",
    "israeli_drivers_license": " of this driver's license",
    "disability_card": " of this disability card",
}

# Layout text sent with the field read of that type alone (see prompts.DISABILITY_CARD_HINT).
_TYPE_HINTS = {"disability_card": DISABILITY_CARD_HINT}


_FLAT_SCHEMAS: dict[tuple[str, str | None], type[BaseModel]] = {}


def flat_schema_for(model: type[BaseModel], doc_type: str | None, carried: set[str] | None) -> type[BaseModel]:
    """The model-facing (Ollama) schema for an API model — flat, unlike the API shape:
    every `ExtractedField` becomes a plain `str | None`, booleans and raw fields
    (`mrz_lines`, `micr_line`) keep their type, and one `uncertain_fields` list replaces
    the `{value, confidence}` wrapper per field (the wrappers cost ~9 output tokens per
    field for the same values, at ~20 tokens/s). `carried` limits the fields to the ones a
    known document type physically has (None = all); the model's full `document_type`
    vocabulary stays so it can still disagree with the detector."""
    key = (model.__name__, doc_type if carried is not None else None)
    if key not in _FLAT_SCHEMAS:
        fields: dict = {"document_type": (model.model_fields["document_type"].annotation, ...)}
        uncertain: list[str] = []
        for name, info in model.model_fields.items():
            if name in ("document_type", "notes") or (carried is not None and name not in carried):
                continue
            if info.annotation is ExtractedField:
                fields[name] = (str | None, ...)
                uncertain.append(name)
            else:
                fields[name] = (info.annotation, ...)
        fields["uncertain_fields"] = (list[Literal[*uncertain]], ...)
        fields["notes"] = (str | None, None)
        stem = "".join(part.title() for part in doc_type.split("_")) if carried is not None else model.__name__.removesuffix("Extraction")
        _FLAT_SCHEMAS[key] = create_model(f"{stem}Fields", **fields)
    return _FLAT_SCHEMAS[key]


def widen(result: BaseModel, model: type[T]) -> T:
    """Flat model-facing result -> the API shape: every `ExtractedField` gets a
    `{value, confidence}` (uncertain -> medium), fields the flat schema left out are
    absent and certain, booleans and raw fields pass through."""
    if isinstance(result, model):
        return result
    data = result.model_dump()
    uncertain = set(data.pop("uncertain_fields", []))
    for name, info in model.model_fields.items():
        if info.annotation is ExtractedField:
            value = data.get(name)
            data[name] = {"value": value, "confidence": "medium" if value and name in uncertain else "high"}
        elif name not in data and info.is_required():
            data[name] = None
    return model.model_validate(data)


def extraction_schema_for(doc_type: str | None) -> type[BaseModel]:
    """Identity documents: `CARRIED_FIELDS` plus `mrz_lines` where an MRZ exists;
    an unknown type gets the generic `DocumentFields` (also the whole-image schema)."""
    carried = CARRIED_FIELDS.get(doc_type) if doc_type else None
    if carried is None:
        return flat_schema_for(DocumentExtraction, None, None)
    return flat_schema_for(DocumentExtraction, doc_type, carried | ({"mrz_lines"} if doc_type in MRZ_TYPES else set()))


def to_document_extraction(result: BaseModel) -> DocumentExtraction:
    return widen(result, DocumentExtraction)


def cheque_schema_for(side: str) -> type[BaseModel]:
    """`cheque` (front, with micr_line) or `cheque_back`."""
    carried = CHEQUE_CARRIED[side] | ({"micr_line"} if side == "cheque" else set())
    return flat_schema_for(ChequeExtraction, side, carried)
