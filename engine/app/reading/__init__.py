"""Stage 4: an image goes to a model, a typed result comes back.

Both backends are constrained to the same Pydantic schemas: Anthropic through
messages.parse, Ollama through the format JSON-schema parameter. Free-form model text is
never parsed. RunOptions selects backend, model and key for one request only, published
through a ContextVar.
"""

import logging
import time
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass, field

from .. import config
from ..cropping import Frame, encode_floor
from ..doctypes import LABEL_TO_TYPE
from ..errors import ConfigurationError, ExtractionError
from ..schemas import CHEQUE_TYPES, ChequeExtraction, DocumentExtraction, SefachExtraction


@dataclass
class CallUsage:
    """Token counts of one model call — what _log_usage logs, kept for accounting."""
    backend: str
    model: str
    schema: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


# Set by run() for the duration of one pipeline; every model call appends to it.
_usage_collector: ContextVar[list[CallUsage] | None] = ContextVar("makor_usage", default=None)


@dataclass(frozen=True)
class RunOptions:
    """What one request runs on. Defaults come from config; main.py overrides them from
    the X-Backend / X-Model / X-Anthropic-Key headers the web app sends."""
    backend: str
    model: str
    api_key: str | None = field(repr=False)  # never let a secret reach a log or an assertion diff
    effort: str
    classifier_model: str = ""  # stage 3a's model; "" only in tests that build RunOptions by hand

    @classmethod
    def from_config(cls) -> RunOptions:
        return cls(backend=config.BACKEND, model=config.MODEL, api_key=None, effort=config.ANTHROPIC_EFFORT,
                   classifier_model=config.default_classifier_model(config.BACKEND, config.MODEL))

    @classmethod
    def resolve(cls, backend: str | None, model: str | None, api_key: str | None) -> RunOptions:
        chosen = (backend or config.BACKEND).lower()
        if chosen not in ("ollama", "anthropic"):
            raise ConfigurationError(f"Unknown backend: {chosen!r} (use 'ollama' or 'anthropic')")
        resolved_model = model or config.default_model(chosen)
        return cls(
            backend=chosen,
            model=resolved_model,
            api_key=api_key or None,
            effort=config.ANTHROPIC_EFFORT,
            classifier_model=config.default_classifier_model(chosen, resolved_model),
        )


_options: ContextVar[RunOptions | None] = ContextVar("makor_options", default=None)


def current_options() -> RunOptions:
    return _options.get() or RunOptions.from_config()


class Progress:
    """One request's progress channel: the sink main.py streams from, plus the clock and
    the counter every event carries. Events are provenance for a live client — stage
    names, region indices, timings, and the fields one frame read — sent to that caller
    only; nothing here reaches a log."""

    def __init__(self, sink: Callable[[dict], None]):
        self._sink = sink
        self._seq = 0
        self._t0: float | None = None

    def start(self) -> None:
        """Zero the clock: run() calls it when the pipeline begins, so `t` measures the
        pipeline and not the queue wait in front of it."""
        self._t0 = time.monotonic()

    def emit(self, type: str, **payload) -> dict:
        if self._t0 is None:
            self.start()
        self._seq += 1
        event = {"type": type, "seq": self._seq, "t": int((time.monotonic() - self._t0) * 1000), **payload}
        self._sink(event)
        return event


# Set by pipeline.run() for one request when the caller asked for progress; None otherwise.
_progress: ContextVar[Progress | None] = ContextVar("makor_progress", default=None)


def emit_progress(type: str, **payload) -> None:
    """Report one pipeline step to the request's channel, if it has one."""
    progress = _progress.get()
    if progress is not None:
        progress.emit(type, **payload)


# Token counts per model call — the only place the service logs anything about a
# request. Counts and timings only; never prompts, images or extracted values.
usage_log = logging.getLogger("makor.usage")


def _log_usage(backend: str, schema: type, model: str | None = None, **counts) -> None:
    model = model or current_options().model
    fields = " ".join(f"{k}={v}" for k, v in counts.items())
    usage_log.info("backend=%s model=%s schema=%s %s", backend, model, schema.__name__, fields)
    collected = _usage_collector.get()
    if collected is not None:
        collected.append(CallUsage(
            backend=backend, model=model, schema=schema.__name__,
            input_tokens=int(counts.get("input_tokens") or 0),
            output_tokens=int(counts.get("output_tokens") or 0),
            cache_read_tokens=int(counts.get("cache_read_tokens") or 0),
            cache_write_tokens=int(counts.get("cache_write_tokens") or 0),
        ))


@dataclass
class RegionOutcome:
    document_type: str
    extraction: DocumentExtraction | None = None
    sefach: SefachExtraction | None = None
    cheque: ChequeExtraction | None = None
    # Stage A ran and came back with nothing: the transcript looped, was cut off, or held
    # no line. The fields were then read straight from the pixels, with no anchor to pin
    # them and no printed label to open the label gate — pipeline says so in a warning,
    # because an empty `sex` then means "not read", not "this card does not print one".
    blind: bool = False


from .backend_anthropic import get_client as get_client  # noqa: E402
from .backend_anthropic import read_frame_anthropic  # noqa: E402
from .backend_ollama import Transcribed, _extract_cheque_ollama, _extract_region_ollama  # noqa: E402
from .backend_ollama import _ollama_json as _ollama_json  # noqa: E402
from .classify import classify_frame as classify_frame  # noqa: E402


async def read_frame(frame: Frame) -> RegionOutcome:
    """Dispatch one region (or the whole image) by the detector's label: cheques go to
    the cheque path, everything else to the identity path; each side can redirect to
    the other when the model disagrees with the detector, reusing the transcription."""
    if current_options().backend == "anthropic":
        return await read_frame_anthropic(frame)
    region_image, label = frame.image, frame.label
    floor = encode_floor(frame)
    expected = LABEL_TO_TYPE.get(label) if label else None
    transcribed: Transcribed | None = None
    if expected in CHEQUE_TYPES:
        cheque, transcribed = await _extract_cheque_ollama(region_image, expected, floor=floor)
        if cheque.document_type in CHEQUE_TYPES:
            return RegionOutcome(cheque.document_type, cheque=cheque, blind=_blind(transcribed))
        expected = None  # the model says it is not a cheque: read it as an identity document
    doc, sefach, transcribed = await _extract_region_ollama(
        region_image, expect_sefach=label == "sefach", expected_type=expected, transcribed=transcribed, floor=floor
    )
    if doc.document_type in CHEQUE_TYPES:
        try:
            cheque, _ = await _extract_cheque_ollama(region_image, doc.document_type, transcribed, floor=floor)
        except ExtractionError:
            # A speculative re-read on top of a finished identity answer: a region the
            # generic schema mislabelled "cheque" (seen on a blank sefach page, where the
            # cheque schema then generated until the token cap twice) must not fail the
            # whole request. Keep what the identity path already read.
            doc.document_type = "other"
        else:
            if cheque.document_type in CHEQUE_TYPES:
                return RegionOutcome(cheque.document_type, cheque=cheque, blind=_blind(transcribed))
            doc.document_type = "other"  # neither path accepts it as a cheque
    return RegionOutcome(doc.document_type, extraction=doc, sefach=sefach, blind=_blind(transcribed))


def _blind(transcribed: Transcribed | None) -> bool:
    """Stage A ran (a sefach frame read block by block never transcribes) and its
    transcript is empty."""
    return transcribed is not None and not transcribed[0]
