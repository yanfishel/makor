import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the repository root (one file for engine and web) regardless of cwd.
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")


def setting(name: str, default: str) -> str:
    """An environment variable, stripped; blank reads as unset. .env.example leaves most keys
    empty to mean "the default", and load_dotenv exports them as "". The two effort variables
    read os.environ directly: for them empty means "send no effort"."""
    return os.environ.get(name, "").strip() or default


# "ollama" (local, free) or "anthropic" (paid API)
BACKEND = setting("MAKOR_BACKEND", "ollama").lower()

# NB: the instruct variant, not plain qwen3-vl:8b — the latter defaults to
# reasoning mode, which is ~10x slower here and can't be disabled ("think":
# false returns empty content on Ollama 0.32).
_DEFAULT_MODELS = {"ollama": "qwen3-vl:8b-instruct", "anthropic": "claude-opus-5"}
MODEL = setting("MAKOR_MODEL", _DEFAULT_MODELS.get(BACKEND, "qwen3-vl:8b"))

# The local models the app offers (settings → "Local model"; GET /models reports which
# are pulled). An allow-list, not `ollama list`: `qwen3-vl:8b` (no -instruct) is reasoning
# mode at ~4 min per document, and the dense `qwen3-vl:32b-instruct` (20.9 GB) spills past
# Metal's share of a 32 GB machine. Ordered; the first entry is the tuned default. The
# notes are the UI's one-line description and stay English like the model names.
# Measured 2026-09-11 (phase 2, two corpus passes each): the 30B MoE (3B active) reads
# cheques and foreign-passport MRZs better and is 25-40 % faster on single-frame pages,
# but loops its transcription on the four old laminated cards (nothing bounded it) and is
# 1.2-2.9x slower on card and multi-frame pages. README "Local models" carries the numbers.
LOCAL_MODELS: tuple[dict[str, str], ...] = (
    {"id": "qwen3-vl:8b-instruct", "label": "Qwen3-VL 8B",
     "note": "6 GB download, ~10 GB RAM; the tuned default"},
    {"id": "qwen3-vl:30b-a3b-instruct", "label": "Qwen3-VL 30B-A3B",
     "note": "19.6 GB download, needs 32 GB RAM; recommended for cheques and passports, "
             "experimental for ID cards: a transcription loop costs the old laminated card "
             "its parents, sex and place of birth, and publishes an expiry that card does not print"},
)
# GET /models asks Ollama for its tags; a settings page must not hang on a stopped Ollama.
OLLAMA_TAGS_TIMEOUT_SECONDS = 3


def default_model(backend: str) -> str:
    """The model a backend runs when the request names none: the env override for the
    env backend, otherwise the built-in default."""
    if backend == BACKEND:
        return MODEL
    return _DEFAULT_MODELS.get(backend, MODEL)


# --- Frame classification (stage 3a, app/reading/classify.py) ------------------------
# One tiny call per frame on a thumbnail decides what is read at all (app/triage.py).
# "off" restores the pre-classifier behaviour call for call.
CLASSIFY = setting("MAKOR_CLASSIFY", "on").lower() not in ("off", "0", "false", "no")
# The classifier's model; empty = the backend's own model, which is the recommendation.
# Measured 2026-09-09: claude-haiku-4-5 classes a stamped cheque back as "none" on 4/4
# sheets and one front as "cheque_back", so the cheque_back inheritance cannot rescue it;
# and cost is no argument for a cheaper model (median 196 input / 15 output tokens per
# call on opus). A differing model also makes the web app's per-document token sums span
# two models.
CLASSIFIER_MODEL = setting("MAKOR_CLASSIFIER_MODEL", "") or None


def default_classifier_model(backend: str, model: str) -> str:
    """The classifier model for a request: the env override when the request runs on the
    env backend (a model name is backend-specific), otherwise the request's own model."""
    if backend == BACKEND and CLASSIFIER_MODEL:
        return CLASSIFIER_MODEL
    return model


# The classifier's reasoning effort on Anthropic; empty = send no output_config (the API
# default, which on Opus means more thinking than the reader's "medium" for a one-word
# answer — a page-first call on the wallet scan spent 259 output tokens and 5 s). Like
# ANTHROPIC_EFFORT, it reaches only a model that accepts `effort` (supports_effort, checked
# in _anthropic_parse); the reader keeps ANTHROPIC_EFFORT.
CLASSIFY_EFFORT = os.environ.get("MAKOR_CLASSIFY_EFFORT", "low").strip().lower()


def supports_effort(model: str) -> bool:
    """Whether the Anthropic API accepts `output_config.effort` for this model: the Opus
    line, Sonnet from 4.6 on, and Fable. Haiku and Sonnet 4.5 reject it with a 400."""
    if model.startswith("claude-sonnet-4-5"):
        return False
    return model.startswith(("claude-opus-", "claude-sonnet-", "claude-fable-"))


# The classifier sees a thumbnail: it tells a card from a cheque from a form by shape
# and colour, never by reading text. 512 px is ~280 image tokens on Anthropic (measured
# 283 with count_tokens) against ~1 300 for the 1568 px frame, and 1-2 s of image
# encoding on Ollama against ~5.
# Raised to 640/768 only if a real document is classed "none" on the corpus.
CLASSIFY_THUMB_DIM = 512
CLASSIFY_MAX_TOKENS = 32  # Ollama num_predict: the answer is one short JSON object
CLASSIFY_MAX_TOKENS_ANTHROPIC = 1024  # adaptive thinking tokens count against max_tokens

# --- Geometry pre-gate (triage.geometry_kinds / page_is_junk), before any model call ---
# A region no document can be is "none" without a classifier call, and a page holding
# more than one such region — or one that is not inside a real document — is rejected
# outright: a garbage page shows itself in the detector's geometry before any model sees
# it. Measured on the 22 samples (2026-09-09): the smallest real frame is the reference
# card crop, 357 px on its long edge; the largest real aspect 2.32 (a whole-page cheque
# scan); the one overlapping pair is a 102x431 sliver 67% inside a passport page (kept:
# a single contained sliver does not reject). A garbage A4 produced two "cheques" of
# aspect 4.3-4.7 and three 112-186 px scraps, and cost four classifier calls (18 s).
MIN_FRAME_EDGE = 250
MAX_FRAME_ASPECT = 3.5
MAX_CONTAINMENT = 0.5
# Three or more classifiable regions on one page: classify the page once first, "none"
# answers the whole page. Corpus: one such page (the wallet scan), classed teudat_zehut 2/2.
PAGE_FIRST_MIN_REGIONS = 3

OLLAMA_URL = setting("MAKOR_OLLAMA_URL", "http://localhost:11434")
# How long Ollama keeps the model loaded after a request. Its default (5m) means a
# 3-5 s cold reload whenever requests are more than five minutes apart.
OLLAMA_KEEP_ALIVE = setting("MAKOR_OLLAMA_KEEP_ALIVE", "30m")
# Local inference on a laptop can be slow — generous timeout.
OLLAMA_TIMEOUT_SECONDS = 300

# "dev" (default) or "prod". In prod the service refuses to start without API keys.
ENV = setting("MAKOR_ENV", "dev").lower()

# Reasoning effort for the Anthropic backend ("low" … "max"); empty = the API default.
# Measured on the corpus with claude-opus-5 (2 rounds each): default 15-21 s/doc, medium
# 12.7 s/doc with every value identical, low 8-10 s/doc but misreads the family name
# on the blurry scan (one letter of the family name swapped, 2/2 runs). Hence medium.
ANTHROPIC_EFFORT = os.environ.get("MAKOR_ANTHROPIC_EFFORT", "medium").strip().lower()


def has_anthropic_key() -> bool:
    """Whether the engine holds its own Anthropic credential (the SDK reads either variable).
    Read at call time, not import time: /healthz reports it so the web app can gate the
    anthropic backend for a user who has saved no key of their own."""
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))

# --- Engine access -----------------------------------------------------------------
# Shared secret the web app sends as X-Engine-Secret. Empty = no check (local dev);
# MAKOR_ENV=prod refuses to start without it — the engine has no auth of its own.
ENGINE_SECRET = os.environ.get("MAKOR_ENGINE_SECRET", "").strip()

# Admission control (app/gate.py): how many extractions run at once and how many
# more may wait for a slot before new requests get an immediate 503. Ollama
# serves vision models one at a time, so 1 is the only useful value there; the
# Anthropic API takes parallel calls.
MAX_CONCURRENCY = int(setting("MAKOR_MAX_CONCURRENCY", "1" if BACKEND == "ollama" else "8"))
MAX_QUEUE = int(setting("MAKOR_MAX_QUEUE", "4"))
OVERLOAD_RETRY_AFTER_SECONDS = 30

# Images are downscaled so the longest side fits this many pixels before
# being sent to the model — larger images cost more tokens without
# improving extraction quality.
MAX_IMAGE_DIMENSION = 1568
JPEG_QUALITY = 90
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
# Ingest cap: a page is downscaled at decode time so its long edge fits this many pixels
# — an A4 sheet at 300 dpi. DPI tags cannot be trusted (most samples carry none), so the
# cap is in pixels; every crop is then cut from this page. Measured 2026-09-10: at 2339
# (A4 at 200 dpi) the 300 dpi wallet scan lost the old laminated card's sex 2/2 — the
# card is a tenth of the page and its המין label dropped out of the transcript; at 3508
# that scan is untouched and the 4160 px phone photo of a passport reads the same.
MAX_PAGE_DIMENSION = 3508
PDF_RENDER_DPI = 200  # the first page of a PDF upload is rendered at this resolution
# Pillow's decompression-bomb guard (89 MP by default) would reject a 30 MB JPEG as
# unreadable; JPEGs are decoded at reduced scale (draft) so this is a header check only.
MAX_DECODE_PIXELS = 300_000_000

# --- Frame resolution (app/resolution.py, applied in pipeline._run) ---------------------
# A frame's dpi is estimated from its classified kind's physical size (an ID-1 card is
# 85.6 mm long) or from the scanned page (A4 = 297 mm); every frame with an estimate is
# resampled to TARGET_DPI, and a source below WARN_DPI is reported to the client. The
# pixel floor CROP_MIN_DIM applies only to frames whose dpi is unknown. Measured
# 2026-09-10 (A/B min_dim 0 vs 1024 on Anthropic): the 100 dpi cheques need the upscale
# — a date, an amount, addresses and drawer names went wrong 2/2 at their native size —
# so the rule keeps it but names it. TARGET_DPI is env-configurable so an A/B runs two
# engines on the same code; the value shipped is the measured one (docs/engine-pipeline.md §2b).
# Measured 2026-09-10 (base = the 1024 px floor; 200 and 300 as candidates; 3 runs per side
# on every differing file): on Anthropic 300 beat the base 2:1 on verified fields and 200
# lost to it 2:3 (a card's ID digit and birth year); on Ollama the 8B model's crop lottery
# gave 300 a licence photo and a card's ID and cost one old laminated photocopy its
# parents/sex (250/350 dpi read them again — non-monotonic, not a resolution law). 300 dpi
# is also the ~1024 px a card had under the old floor, the size the corpus was tuned on.
# Cost: +38 % Anthropic input tokens, all of it on 100 dpi cheques upscaled to the 1568 cap.
TARGET_DPI = int(setting("MAKOR_TARGET_DPI", "300"))
WARN_DPI = 150  # the resolution guidance in /docs and the upload hint; below it, warn
# The estimate is ~10 % coarse (a Letter page taken for A4 reads 141 dpi at 150, a loose
# detector box adds a few percent), so the warning fires only clearly below WARN_DPI.
DPI_TOLERANCE = 0.10
RESAMPLE_TOLERANCE = 0.05  # a factor this close to 1.0 is not worth a resample's blur


def check_startup() -> None:
    """Fail fast on a configuration that must never reach production."""
    if ENV == "prod" and not ENGINE_SECRET:
        raise RuntimeError("MAKOR_ENV=prod requires MAKOR_ENGINE_SECRET — refusing to start an open engine")
    if MAX_CONCURRENCY < 1 or MAX_QUEUE < 0:
        raise RuntimeError("MAKOR_MAX_CONCURRENCY must be >= 1 and MAKOR_MAX_QUEUE >= 0")
    if not 50 <= TARGET_DPI <= 600:
        raise RuntimeError("MAKOR_TARGET_DPI must be between 50 and 600")
    # LOCAL_MODELS feeds schemas.ModelInfo(**entry) on the GET /models path (main.py). A key
    # missing from this constant is a typo, and it should cost a failed boot rather than the
    # first user request that reaches that endpoint. The keys are spelled here rather than
    # read off ModelInfo because schemas is the same import tier as config.
    for entry in LOCAL_MODELS:
        if set(entry) != {"id", "label", "note"}:
            raise RuntimeError(f"LOCAL_MODELS entry must have exactly id, label and note: {sorted(entry)}")
