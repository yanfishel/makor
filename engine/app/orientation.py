"""Stage 3a: which way up is this crop?

Two independent signals. is_degenerate reads the model's own failure: upside-down Hebrew
makes the 8B model repeat one short line until the token cap. detect_rotation asks a
text-line angle classifier before any model call — and, before that, the text DETECTOR's
box shapes: a crop lying on its side has its lines standing up (boxes taller than wide),
which the angle classifier (0/180 only) cannot see but the boxes show at once.
"""

import logging

import numpy as np
from PIL import Image

DEGENERATE_MIN_LINES = 20
DEGENERATE_MAX_DISTINCT = 0.25


def is_degenerate(lines: list[str]) -> bool:
    """True when a transcription looped instead of reading.

    Measured on an upside-down sefach crop: 134 lines with 4 distinct values in one run and
    84 with 7 in another, against 28 lines with 27 distinct once rotated. The floor on line
    count keeps a short, legitimately repetitive crop from tripping it.
    """
    if len(lines) < DEGENERATE_MIN_LINES:
        return False
    return len(set(lines)) / len(lines) < DEGENERATE_MAX_DISTINCT


MIN_LINES = 8
MIN_MARGIN = 0.20
# Fraction of text boxes taller than wide above which the crop lies on its side. Measured
# on the corpus (2026-09-10): a card scanned sideways 21/21, a 300 dpi card that lands on
# its side after deskew 23/24; every upright frame <= 12/49 (a passport spread's vertical
# Devanagari margin text). The angle classifier only tells 0 from 180, so a sideways crop
# is first turned a quarter turn and then asked which of the two quarter turns reads upright.
SIDEWAYS_MIN_FRACTION = 0.8


def decide(votes: list[tuple[str, float]]) -> int | None:
    """0, 180, or None for "do not know", from per-line angle votes.

    Gated on purpose. Over 62 trials a plain majority got 10 of 61 decisions wrong, while
    this gate decided 34 with zero errors and abstained on the rest. The classifier was
    trained on Latin and CJK: it recognises upright Hebrew confidently and is often unsure
    about inverted Hebrew, so abstention is the common case and the right default.
    """
    if len(votes) < MIN_LINES:
        return None
    upright = sum(score for label, score in votes if label == "0")
    inverted = sum(score for label, score in votes if label == "180")
    total = upright + inverted
    if total <= 0:
        return None
    if abs(upright - inverted) / total < MIN_MARGIN:
        return None
    return 180 if inverted > upright else 0


def _box_is_tall(box) -> bool:
    """A detector quadrilateral (four points, clockwise from the top-left) standing up."""
    b = np.asarray(box, dtype=float)
    return float(np.linalg.norm(b[3] - b[0])) > float(np.linalg.norm(b[1] - b[0]))


def sideways(boxes) -> bool:
    """True when at least MIN_LINES text boxes were found and SIDEWAYS_MIN_FRACTION of them
    stand up: the lines are vertical, so the crop lies on its side."""
    boxes = list(boxes) if boxes is not None else []
    if len(boxes) < MIN_LINES:
        return False
    return sum(_box_is_tall(b) for b in boxes) / len(boxes) >= SIDEWAYS_MIN_FRACTION


def pick_sideways(votes_90: list[tuple[str, float]], votes_270: list[tuple[str, float]]) -> int:
    """90 or 270 for a crop known to lie on its side, from the angle votes on the crop
    turned each way (PIL angles, counter-clockwise). A decisive gate answer on either turn
    settles it; otherwise the turn with the larger net upright score, since a weak
    preference beats a coin flip on a crop that is certainly not upright; a tie says 90."""
    d90 = decide(votes_90)
    if d90 is not None:
        return 90 if d90 == 0 else 270
    d270 = decide(votes_270)
    if d270 is not None:
        return 270 if d270 == 0 else 90

    def net(votes):
        return sum(s for label, s in votes if label == "0") - sum(s for label, s in votes if label == "180")

    return 270 if net(votes_270) > net(votes_90) else 90


_ENGINE = None
# Set once an import attempt fails, so a missing optional package is only ever logged
# once and every later call goes straight to the disabled path instead of retrying an
# import that will not start succeeding mid-process.
_IMPORT_FAILED = False

# requirements.txt deliberately does NOT install rapidocr-onnxruntime on a plain
# `pip install -r requirements.txt` (that would drag in opencv-python's desktop build
# alongside the opencv-python-headless this engine uses) — only the Dockerfile and
# scripts/run.sh's bootstrap message run the real --no-deps install. A developer who
# only ran the plain requirements install is missing the package on purpose; this names
# the exact command that finishes the job.
_INSTALL_HINT = "pip install --no-deps rapidocr-onnxruntime==1.2.3"


def _ocr():
    global _ENGINE, _IMPORT_FAILED
    if _ENGINE is None and not _IMPORT_FAILED:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError:
            _IMPORT_FAILED = True
            logging.getLogger("makor.usage").warning(
                "rapidocr-onnxruntime not installed — orientation detection disabled "
                "(a document is still processed, just without this check); to enable "
                "it: %s", _INSTALL_HINT,
            )
            return None
        _ENGINE = RapidOCR()
    return _ENGINE


def detect_rotation(image: Image.Image) -> int | None:
    """Ask the text-line angle classifier which way up this crop is.

    Calls only the 2.3 MB text detector and the 0.6 MB angle classifier. The library
    builds all three ONNX sessions — including the 10.2 MB recogniser — at construction
    time regardless, so the recogniser is loaded into memory either way; it is simply
    never CALLED here. We need where the lines are and which way up they sit, never
    what they say, and never calling it is what keeps document text out of this process.

    Returns None — "do not know" — when the optional package is not installed, exactly
    like every other case this function cannot decide; orientation is advisory and a
    missing dependency must never fail a document.
    """
    engine = _ocr()
    if engine is None:
        return None
    array = _bgr(image)
    boxes, _ = engine.text_detector(array)
    if boxes is None or len(boxes) == 0:
        return None
    if sideways(boxes):
        votes_90 = _angle_votes(engine, _bgr(image.rotate(90, expand=True)))
        if decide(votes_90) is not None:
            return pick_sideways(votes_90, [])
        return pick_sideways(votes_90, _angle_votes(engine, _bgr(image.rotate(270, expand=True))))
    return decide(_cls_votes(engine, array, boxes))


def _bgr(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("RGB"))[:, :, ::-1].copy()


def _angle_votes(engine, array: np.ndarray) -> list[tuple[str, float]]:
    """Detector then angle classifier on one array; no boxes = no votes."""
    boxes, _ = engine.text_detector(array)
    if boxes is None or len(boxes) == 0:
        return []
    return _cls_votes(engine, array, boxes)


def _cls_votes(engine, array: np.ndarray, boxes) -> list[tuple[str, float]]:
    _, votes, _ = engine.text_cls(engine.get_crop_img_list(array, engine.sorted_boxes(boxes)))
    return [(label, float(score)) for label, score in votes]
