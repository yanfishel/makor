import asyncio
import json
import logging
import secrets
from contextlib import asynccontextmanager

import anthropic
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from . import assemble, cheque_check, config, doctypes, imaging, mrz_check, pipeline
from .errors import ConfigurationError, ExtractionError
from .gate import AdmissionGate, Overloaded
from .reading import Progress, RunOptions, backend_ollama
from .schemas import (
    CHEQUE_FIELDS_EXCLUDE,
    IDENTITY_FIELDS_EXCLUDE,
    CallUsageOut,
    ChequeExtraction,
    ExtractionResponse,
    ModelInfo,
    ModelsResponse,
    ValidationReport,
)

# Uvicorn only configures its own loggers; without this the makor.* INFO lines
# (token usage per model call) would be dropped. Bodies and values are never logged.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("makor.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.check_startup()
    yield


app = FastAPI(title="Makor engine", description="Stateless OCR engine for Israeli documents", lifespan=lifespan)

gate = AdmissionGate(limit=config.MAX_CONCURRENCY, max_waiting=config.MAX_QUEUE)


def _require_secret(request: Request) -> None:
    """The engine has no auth of its own: the web app proves itself with a shared secret.
    No secret configured (local dev) = open."""
    if config.ENGINE_SECRET and not secrets.compare_digest(
        request.headers.get("x-engine-secret", "").encode(), config.ENGINE_SECRET.encode()
    ):
        raise HTTPException(status_code=401, detail="Missing or wrong X-Engine-Secret")


def _options(request: Request) -> RunOptions:
    try:
        return RunOptions.resolve(
            request.headers.get("x-backend"),
            request.headers.get("x-model"),
            request.headers.get("x-anthropic-key"),
        )
    except ConfigurationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _http_error(exc: BaseException) -> HTTPException | None:
    """The one mapping from a pipeline failure to an HTTP error, shared by both forms of
    /extract. Typed anthropic.* exceptions are mapped one by one — extend this chain
    rather than catching broad Exception. None = not ours, let it propagate."""
    if isinstance(exc, Overloaded):
        return HTTPException(status_code=503, detail="Service busy: extraction queue is full, retry later",
                             headers={"Retry-After": str(config.OVERLOAD_RETRY_AFTER_SECONDS)})
    if isinstance(exc, ConfigurationError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, ExtractionError):
        return HTTPException(status_code=502, detail=str(exc))
    if isinstance(exc, anthropic.AuthenticationError):
        # Only reachable with a caller-supplied key: the web app turns this into its own
        # "invalid Anthropic key" error for the user. Must precede APIStatusError.
        return HTTPException(status_code=502, detail={"message": "Model API rejected the API key", "anthropic_status": 401})
    if isinstance(exc, anthropic.RateLimitError):
        return HTTPException(status_code=429, detail="Upstream rate limit, retry later")
    if isinstance(exc, anthropic.APIStatusError):
        return HTTPException(status_code=502, detail=f"Model API error ({exc.status_code})")
    if isinstance(exc, anthropic.APIConnectionError):
        return HTTPException(status_code=502, detail="Cannot reach model API")
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=422, detail=str(exc))
    return None


def _response(pipeline_result: pipeline.PipelineResult, options: RunOptions) -> ExtractionResponse:
    model_label = f"{options.backend}/{options.model}"
    usage = [CallUsageOut(backend=u.backend, model=u.model, schema_name=u.schema, input_tokens=u.input_tokens,
                          output_tokens=u.output_tokens, cache_read_tokens=u.cache_read_tokens,
                          cache_write_tokens=u.cache_write_tokens) for u in pipeline_result.usage]
    extraction, cheque = pipeline_result.extraction, pipeline_result.cheque
    if cheque is not None and (extraction is None or extraction.document_type not in doctypes.IDENTITY_TYPES):
        response = _cheque_response(pipeline_result, cheque, model_label)
    elif extraction is None or (extraction.document_type == "other" and pipeline_result.classified_type is None):
        # Nothing read (every frame skipped by triage), or every frame the reader saw
        # came back "other": one answer for both modes, with or without the classifier.
        response = _not_a_document_response(pipeline_result, model_label)
    else:
        response = _identity_response(pipeline_result, model_label)
    response.usage = usage
    return response


async def _stream(raw: bytes, options: RunOptions):
    """The NDJSON form: one JSON object per line, the pipeline's events as they happen,
    then `done` with the very body the one-shot form returns, or `error` with the status
    and detail it would have sent. The pipeline runs in its own task: a client that goes
    away mid-stream does not stop it, and the gate slot is released only when it ends."""
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    progress = Progress(queue.put_nowait)

    async def work() -> None:
        try:
            async with gate.slot():
                result = await pipeline.run(raw, options, progress=progress)
            progress.emit("done", result=_response(result, options).model_dump(mode="json"))
        except Exception as exc:
            error = _http_error(exc)
            if error is None:
                log.exception("extract stream failed")
                error = HTTPException(status_code=500, detail="Unexpected error")
            progress.emit("error", status=error.status_code, detail=error.detail)
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(work())
    try:
        while (event := await queue.get()) is not None:
            yield json.dumps(event, ensure_ascii=False) + "\n"
    finally:
        await task


def _ingest(raw: bytes) -> None:
    if len(raw) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 30 MB)")
    try:
        imaging.load_image(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="File is not a readable image") from exc


@app.post("/extract", response_model=ExtractionResponse, dependencies=[Depends(_require_secret)])
async def extract_document(request: Request, file: UploadFile = File(...)):
    options = _options(request)
    raw = await file.read()
    _ingest(raw)

    if "application/x-ndjson" in request.headers.get("accept", ""):
        # Decided before the response starts, so a full queue is still a plain 503.
        if gate.would_reject():
            raise _http_error(Overloaded())
        return StreamingResponse(_stream(raw, options), media_type="application/x-ndjson",
                                 headers={"cache-control": "no-store"})

    try:
        async with gate.slot():
            pipeline_result = await pipeline.run(raw, options)
    # Not the blanket-catch this codebase forbids: _http_error maps only the exception
    # types it knows and returns None for anything else, which the bare `raise` below
    # re-raises untouched, original traceback and all. The broad catch here is what lets
    # this one-shot form and the streaming form below share that single mapping instead
    # of each repeating the typed except chain.
    except Exception as exc:
        error = _http_error(exc)
        if error is None:
            raise
        raise error from exc
    return _response(pipeline_result, options)


def _not_a_document_response(pipeline_result: pipeline.PipelineResult, model_label: str) -> ExtractionResponse:
    return ExtractionResponse(
        document_type="not_a_document",
        fields={},
        validation=ValidationReport(),
        warnings=["No supported document was found on the page", *pipeline_result.warnings],
        regions=pipeline_result.regions,
        sefach=None,
        model=model_label,
    )


def _identity_response(pipeline_result: pipeline.PipelineResult, model_label: str) -> ExtractionResponse:
    result = pipeline_result.extraction
    validation = mrz_check.validate(result)

    warnings = list(pipeline_result.warnings)
    if result.document_type == "unreadable":
        warnings.append("Image quality too low to extract fields reliably")
    if validation.mrz_present and validation.mrz_checksums_valid is False:
        warnings.append("MRZ checksums failed")
    if validation.id_number_checksum_valid is False:
        warnings.append("Israeli ID number failed its check-digit test")
    if validation.overall == "mismatch":
        warnings.append("Visual fields do not match the MRZ")
    if result.notes:
        warnings.append(result.notes)

    document_type = result.document_type
    if pipeline_result.classified_type:
        # Phase 1 of the unsupported types: the reader said "other", the classifier said
        # which card it is. Generic-schema values, labelled as such.
        document_type = pipeline_result.classified_type
        warnings.append(f"Field extraction for {document_type} is not tuned; values are best effort")

    field_dump = result.model_dump(exclude=IDENTITY_FIELDS_EXCLUDE)

    return ExtractionResponse(
        document_type=document_type,
        fields=field_dump,
        validation=validation,
        warnings=warnings,
        regions=pipeline_result.regions,
        sefach=assemble.sefach_payload(pipeline_result.sefach) if pipeline_result.sefach else None,
        model=model_label,
    )


def _cheque_response(pipeline_result: pipeline.PipelineResult, cheque: ChequeExtraction, model_label: str) -> ExtractionResponse:
    validation = cheque_check.validate(cheque)
    warnings = list(pipeline_result.warnings)
    if cheque.document_type == "unreadable":
        warnings.append("Image quality too low to extract fields reliably")
    if validation.micr_present and not validation.micr_parsed:
        warnings.append("MICR line present but could not be parsed")
    micr_checks = [c for c in validation.cross_checks if c.field != "amount" and c.visual and c.reference]
    if any(not c.match for c in micr_checks):
        warnings.append("MICR present but does not match printed details")
    amount_check = next((c for c in validation.cross_checks if c.field == "amount"), None)
    # validate() now registers this check one-sided as well, so `not match` no longer means
    # the two readings disagreed — it also covers "only one side was read". Both sides
    # present is what separates the two warnings; without that they swapped.
    compared = amount_check is not None and bool(amount_check.visual and amount_check.reference)
    if compared and not amount_check.match:
        warnings.append("amount in words does not match the figure")
    elif cheque.amount_in_words.value and not compared:
        warnings.append("amount in words not parseable")
    if validation.id_number_checksum_valid is False:
        warnings.append("Israeli ID number failed its check-digit test")
    if validation.guarantor_id_checksum_valid is False:
        warnings.append("guarantor ID failed its check-digit test")
    if cheque.notes:
        warnings.append(cheque.notes)
    return ExtractionResponse(
        document_type=cheque.document_type,
        fields=cheque.model_dump(exclude=CHEQUE_FIELDS_EXCLUDE),
        validation=validation,
        warnings=warnings,
        regions=pipeline_result.regions,
        sefach=None,
        model=model_label,
    )


@app.get("/healthz")
async def health():
    return {
        "status": "ok", "backend": config.BACKEND, "model": config.MODEL,
        "anthropic_key": config.has_anthropic_key(), "queue": gate.snapshot(),
    }


@app.get("/models", response_model=ModelsResponse, dependencies=[Depends(_require_secret)])
async def models():
    """The local models the app may offer, with what Ollama has pulled. Listed on every
    engine backend: the web app's backend switch can pick ollama while the engine defaults
    to anthropic. /healthz stays the liveness probe and never asks Ollama."""
    tags = await backend_ollama.installed_models()
    return ModelsResponse(
        backend=config.BACKEND, default_local=config.default_model("ollama"),
        default_cloud=config.default_model("anthropic"), ollama_reachable=tags is not None,
        models=[ModelInfo(**m, installed=tags is not None and m["id"] in tags) for m in config.LOCAL_MODELS],
    )
