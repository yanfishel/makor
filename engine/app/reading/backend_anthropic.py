"""The Anthropic backend: one structured pass per Frame via messages.parse, with the
schema the detector's label calls for (page + sefach flag when there is no label). No
transcript, no anchors, no label gate — those are the Ollama path's compensations for a
small local model; Anthropic reads the pixels directly. The Frames are the same ones the
Ollama path reads: detection, cropping, deskew, orientation and filters are shared."""

from contextvars import ContextVar

import anthropic
from PIL import Image

from .. import config
from ..cropping import CROP_MIN_DIM, Frame, encode_floor
from ..doctypes import LABEL_TO_TYPE
from ..errors import ConfigurationError, ExtractionError
from ..imaging import encode_jpeg
from ..postprocess import ID_DIGITS, PASSPORT_TYPES, passport_type_from_mrz, postprocess_cheque, postprocess_sefach
from ..schemas import (
    CHEQUE_TYPES,
    AnthropicPageExtraction,
    ChequeExtraction,
    DocumentExtraction,
    ExtractedField,
    IdReread,
    SefachExtraction,
)
from . import RegionOutcome, _log_usage, _options, current_options
from .backend_ollama import sefach_to_document
from .prompts import CHEQUE_SYSTEM_PROMPT, ID_REREAD_ASK, ID_REREAD_PROMPT, SEFACH_SYSTEM_PROMPT, SYSTEM_PROMPT
from .schemas_flat import _CHEQUE_PHRASE, _TYPE_HINTS, T

_client: anthropic.AsyncAnthropic | None = None


# Set by run() for the duration of one pipeline; holds the single client built for a
# user-supplied key so every call in that request reuses it, and run() can close it.
_request_client: ContextVar[anthropic.AsyncAnthropic | None] = ContextVar("makor_request_client", default=None)


def get_client(api_key: str | None = None) -> anthropic.AsyncAnthropic:
    """The engine's own client is cached. A user-supplied key gets one client per request
    (built lazily, closed by run()); outside run() it is built per call and never cached
    — the key must not outlive the request."""
    if api_key:
        current = _request_client.get()
        if current is not None and current.api_key == api_key:
            return current
        client = anthropic.AsyncAnthropic(api_key=api_key)
        if _options.get() is not None:  # inside run(): remember it so run() can close it
            _request_client.set(client)
        return client
    global _client
    if _client is None:
        if not config.has_anthropic_key():
            raise ConfigurationError(
                "ANTHROPIC_API_KEY is not configured. Copy .env.example to .env "
                "and set your key, then restart the server."
            )
        _client = anthropic.AsyncAnthropic()
    return _client


async def _anthropic_parse(
    image_b64: str, system: str, user: str, schema: type[T],
    model: str | None = None, max_tokens: int = 4096, effort: str | None = "request",
) -> T:
    """One structured call. `model` overrides the request's model for this call (the
    classifier's own model); `effort` is the request's own by default, an explicit level
    for this call, or None to send no output_config at all. Whatever is asked, a model that
    rejects `effort` (config.supports_effort — Haiku answers 400) is sent none: the user
    picks the model in settings, so this is the one place that sees every call's model."""
    opts = current_options()
    chosen = model or opts.model
    level = opts.effort if effort == "request" else effort
    if not config.supports_effort(chosen):
        level = None
    extra: dict = {"output_config": {"effort": level}} if level else {}
    response = await get_client(opts.api_key).messages.parse(
        model=chosen,
        max_tokens=max_tokens,
        **extra,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}},
                    {"type": "text", "text": user},
                ],
            }
        ],
        output_format=schema,
    )
    usage = getattr(response, "usage", None)
    _log_usage(
        "anthropic", schema, model=chosen,
        input_tokens=getattr(usage, "input_tokens", None),
        output_tokens=getattr(usage, "output_tokens", None),
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", None),
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", None),
        effort=level or "default",
        stop_reason=response.stop_reason,
    )
    if response.stop_reason == "refusal":
        detail = ""
        if response.stop_details and response.stop_details.explanation:
            detail = f": {response.stop_details.explanation}"
        raise RuntimeError(f"Model declined to process this image{detail}")
    if response.parsed_output is None:
        # A max_tokens stop leaves nothing parsed; without this the caller trips over
        # None attributes and the request answers 500 instead of the upstream 502.
        raise ExtractionError(f"model output truncated ({response.stop_reason})")
    return response.parsed_output


async def read_frame_anthropic(frame: Frame) -> RegionOutcome:
    """Stage 4 for this backend: one Frame -> typed fields, by the detector's label."""
    image_b64 = encode_jpeg(frame.image, config.MAX_IMAGE_DIMENSION, min_dim=encode_floor(frame))
    doc, sefach, cheque = await _extract_anthropic(image_b64, frame.label)
    if cheque is not None:
        return RegionOutcome(cheque.document_type, cheque=cheque)
    return RegionOutcome(doc.document_type, extraction=doc, sefach=sefach)


async def reread_id_anthropic(image: Image.Image, floor: int = CROP_MIN_DIM) -> str | None:
    """One document's ID number, read again on its own with the printed layout spelled
    out (ID_REREAD_PROMPT). Nine digits or None."""
    image_b64 = encode_jpeg(image, config.MAX_IMAGE_DIMENSION, min_dim=floor)
    answer = await _anthropic_parse(image_b64, ID_REREAD_PROMPT, ID_REREAD_ASK, IdReread)
    digits = "".join(ch for ch in (answer.id_number or "") if ch.isdigit())
    return digits if len(digits) == ID_DIGITS else None


async def _cheque_anthropic(image_b64: str, side: str) -> ChequeExtraction:
    cheque = await _anthropic_parse(
        image_b64, CHEQUE_SYSTEM_PROMPT, f"Extract all fields{_CHEQUE_PHRASE[side]}.", ChequeExtraction,
    )
    return postprocess_cheque(cheque)


async def _sefach_anthropic(image_b64: str, user: str) -> SefachExtraction | None:
    sefach = await _anthropic_parse(image_b64, SEFACH_SYSTEM_PROMPT, user, SefachExtraction)
    sefach = postprocess_sefach(sefach)
    return None if sefach.document_type == "other" else sefach


async def _extract_anthropic(
    image_b64: str, label: str | None = None,
) -> tuple[DocumentExtraction, SefachExtraction | None, ChequeExtraction | None]:
    """A labelled frame goes straight to its own schema (a cheque side, a sefach sheet);
    when the model disagrees with the label, the frame is read as a page instead. An
    unlabelled frame is the page path: the primary document plus the sefach flag and the
    cheque follow-up, exactly as the whole-page read always worked."""
    expected = LABEL_TO_TYPE.get(label) if label else None
    if expected in CHEQUE_TYPES:
        cheque = await _cheque_anthropic(image_b64, expected)
        if cheque.document_type in CHEQUE_TYPES:
            doc = DocumentExtraction.model_validate(_page_shell(cheque.document_type))
            return doc, None, cheque
    elif label == "sefach":
        sefach = await _sefach_anthropic(image_b64, "Extract all fields from this sefach sheet.")
        if sefach is not None:
            return sefach_to_document(sefach), sefach, None
    ask = "Extract all fields from the primary document on this page (an ID card outranks a sefach sheet)."
    if expected in _TYPE_HINTS:
        ask = f"{ask}\n\n{_TYPE_HINTS[expected]}"  # the type's layout, with its read only
    page = await _anthropic_parse(image_b64, SYSTEM_PROMPT, ask, AnthropicPageExtraction)
    mrz_type = passport_type_from_mrz(page.mrz_lines)
    if mrz_type and page.document_type in PASSPORT_TYPES and page.document_type != mrz_type:
        page = page.model_copy(update={"document_type": mrz_type})  # the issuing state decides, no extra call
    sefach = cheque = None
    if page.document_type == "teudat_zehut_sefach" or page.sefach_present:
        sefach = await _sefach_anthropic(
            image_b64, "Extract all fields from the sefach on this page; ignore any other document next to it.",
        )
    if page.document_type in CHEQUE_TYPES:
        cheque = await _anthropic_parse(
            image_b64, CHEQUE_SYSTEM_PROMPT,
            "Extract all fields from the cheque on this page — its front and, if visible, its back.",
            ChequeExtraction,
        )
        cheque = postprocess_cheque(cheque)
        if cheque.document_type not in CHEQUE_TYPES:
            # The follow-up parse looked at the same page and says it is not a cheque.
            # The page type has to follow, or main.py would take the identity branch and
            # publish "cheque" with empty fields (the Ollama path does the same).
            page.document_type = cheque.document_type
            cheque = None
    doc = DocumentExtraction.model_validate(page.model_dump(exclude={"sefach_present"}))
    return doc, sefach, cheque


def _page_shell(document_type: str) -> dict:
    """A DocumentExtraction with every field empty, carrying only the type — what the
    identity side of a cheque frame's outcome is (the fields live in the cheque)."""
    data: dict = {"document_type": document_type}
    for name, info in DocumentExtraction.model_fields.items():
        if name != "document_type":
            data[name] = {"value": None, "confidence": "high"} if info.annotation is ExtractedField else None
    return data
