"""Upside-down Hebrew makes the 8B model loop: it emits the same short line until the
token cap. Measured on one sample crop, two runs: 134 lines with 4 distinct values, and
84 lines with 7 distinct. The same crop rotated gave 28 lines with 27 distinct.

The vote gate below is measured over 62 trials: 31 detector crops from the sample set,
each as-is and rotated. At margin 0.20 it decided 34 with zero errors and abstained on
28. A plain majority decided 61 but got 10 wrong, so the gate is the whole point."""
import logging
import sys

import pytest
from PIL import Image, ImageDraw, ImageFont

import app.orientation as orientation
from app.orientation import MIN_LINES, MIN_MARGIN, decide, is_degenerate


def test_many_lines_few_distinct_is_degenerate():
    assert is_degenerate(["aaa"] * 45 + ["bbb"] * 44 + ["ccc"] * 45) is True


def test_the_measured_loop_shape_is_degenerate():
    assert is_degenerate(["x"] * 78 + [f"line {i}" for i in range(6)]) is True


def test_a_normal_transcript_is_not_degenerate():
    assert is_degenerate([f"line {i}" for i in range(28)]) is False


def test_a_transcript_with_a_few_repeats_is_not_degenerate():
    assert is_degenerate([f"line {i}" for i in range(25)] + ["date", "date"]) is False


def test_a_short_transcript_is_never_degenerate():
    assert is_degenerate(["a", "a", "a"]) is False


def test_an_empty_transcript_is_not_degenerate():
    assert is_degenerate([]) is False


def _votes(zero: int, one_eighty: int, score: float = 1.0):
    return [("0", score)] * zero + [("180", score)] * one_eighty


def test_a_clear_upright_majority_decides_zero():
    assert decide(_votes(zero=18, one_eighty=2)) == 0


def test_a_clear_inverted_majority_decides_one_eighty():
    assert decide(_votes(zero=2, one_eighty=18)) == 180


def test_a_narrow_margin_abstains():
    assert decide(_votes(zero=11, one_eighty=9)) is None


def test_the_margin_threshold_is_inclusive():
    # 12 vs 8 over 20 lines is exactly 0.20
    assert decide(_votes(zero=12, one_eighty=8)) == 0


def test_too_few_lines_abstains_however_clear():
    assert decide(_votes(zero=MIN_LINES - 1, one_eighty=0)) is None


def test_no_lines_abstains():
    assert decide([]) is None


def test_zero_total_score_abstains():
    assert decide([("0", 0.0)] * 10) is None


def test_the_measured_sefach_crop_margin_decides():
    # the sample that motivated this work scored v0=5.89, v180=10.56 over 20 lines
    assert decide([("0", 5.89)] + [("180", 10.56)] + _votes(zero=9, one_eighty=9, score=0.0)) == 180


def test_constants_match_the_measured_gate():
    assert MIN_LINES == 8
    assert MIN_MARGIN == pytest.approx(0.20)


def test_a_missing_package_makes_detect_rotation_abstain_and_warns_once(monkeypatch, caplog):
    """requirements.txt deliberately does not install rapidocr-onnxruntime on a plain
    `pip install -r requirements.txt` — a developer who only ran that command is
    missing the package on purpose, and must get "do not know", not a crash, plus
    exactly one warning even across repeated calls (the whole point of caching the
    failure)."""
    monkeypatch.setattr(orientation, "_ENGINE", None)
    monkeypatch.setattr(orientation, "_IMPORT_FAILED", False)
    monkeypatch.setitem(sys.modules, "rapidocr_onnxruntime", None)

    image = Image.new("RGB", (10, 10))
    with caplog.at_level(logging.WARNING, logger="makor.usage"):
        assert orientation.detect_rotation(image) is None
        assert orientation.detect_rotation(image) is None
        assert orientation.detect_rotation(image) is None

    warnings = [r for r in caplog.records if r.name == "makor.usage"]
    assert len(warnings) == 1
    assert "rapidocr-onnxruntime" in warnings[0].getMessage()


def test_detect_rotation_never_calls_the_text_recognizer(monkeypatch):
    """The docstring on detect_rotation, and CLAUDE.md, both claim the bundled 10 MB text
    recogniser is never invoked — only the detector and the angle classifier — because
    that is what keeps document text out of this process. Nothing else in the suite
    checks it. Replace the cached engine's recognizer with something that raises if
    called, on an image with real, detectable text lines (so the detector has boxes to
    hand it), and confirm detect_rotation still answers instead of blowing up."""
    pytest.importorskip("rapidocr_onnxruntime")
    engine = orientation._ocr()
    assert engine is not None  # package genuinely available; otherwise this proves nothing

    def _boom(*args, **kwargs):
        raise AssertionError("the text recognizer was called")

    monkeypatch.setattr(engine, "text_recognizer", _boom)

    image = Image.new("RGB", (400, 200), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    for i in range(8):
        draw.text((10, 10 + i * 20), f"Sample line number {i} of text here", fill="black", font=font)

    assert orientation.detect_rotation(image) in (0, 180, None)  # answers rather than raising


# --------------------------------------------------------------------------- sideways (90 / 270)

from app.orientation import SIDEWAYS_MIN_FRACTION, pick_sideways, sideways  # noqa: E402


def _box(w: float, h: float):
    """A text-detector quadrilateral, clockwise from the top-left, w wide and h tall."""
    return [[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]]


def test_mostly_tall_boxes_mean_the_crop_is_sideways():
    assert sideways([_box(10, 60)] * 21) is True  # a card scanned on its side: 21 of 21


def test_a_few_tall_boxes_among_wide_ones_do_not():
    assert sideways([_box(60, 10)] * 37 + [_box(10, 60)] * 12) is False  # the Nepali passport spread: 12 of 49


def test_the_measured_tilted_card_is_sideways():
    assert sideways([_box(10, 60)] * 23 + [_box(60, 10)]) is True  # a 26° deskew leaves one sideways: 23 of 24


def test_too_few_boxes_are_never_sideways():
    assert sideways([_box(10, 60)] * (MIN_LINES - 1)) is False


def test_no_boxes_are_not_sideways():
    assert sideways([]) is False


def test_sideways_fraction_is_the_measured_gap():
    assert SIDEWAYS_MIN_FRACTION == 0.8  # corpus: sideways frames 0.96-1.0, every upright one <= 0.24


def test_pick_sideways_trusts_a_decisive_vote_at_90():
    assert pick_sideways(_votes(zero=18, one_eighty=2), []) == 90
    assert pick_sideways(_votes(zero=2, one_eighty=18), []) == 270


def test_pick_sideways_trusts_a_decisive_vote_at_270():
    assert pick_sideways(_votes(zero=11, one_eighty=9), _votes(zero=18, one_eighty=2)) == 270
    assert pick_sideways(_votes(zero=11, one_eighty=9), _votes(zero=2, one_eighty=18)) == 90


def test_pick_sideways_falls_back_to_the_larger_net_upright_score():
    # both abstain: 90 nets +2 (11 - 9), 270 nets -2 (9 - 11): the crop is sideways for sure,
    # so a weak preference beats a coin flip
    assert pick_sideways(_votes(zero=11, one_eighty=9), _votes(zero=9, one_eighty=11)) == 90
    assert pick_sideways(_votes(zero=9, one_eighty=11), _votes(zero=11, one_eighty=9)) == 270


def test_pick_sideways_ties_towards_90():
    assert pick_sideways([], []) == 90


def _text_image() -> Image.Image:
    image = Image.new("RGB", (700, 400), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=26)
    for i in range(10):
        draw.text((20, 15 + i * 36), f"Sample line number {i} of text here", fill="black", font=font)
    return image


def test_detect_rotation_finds_a_crop_lying_on_its_side():
    """Latin text rendered upright reads 0; the same image turned a quarter turn must come
    back with the angle that turns it upright again (PIL: positive = counter-clockwise,
    so an image rotated by 90 needs 270 and vice versa)."""
    pytest.importorskip("rapidocr_onnxruntime")
    upright = _text_image()
    assert orientation.detect_rotation(upright) == 0
    assert orientation.detect_rotation(upright.rotate(90, expand=True)) == 270
    assert orientation.detect_rotation(upright.rotate(270, expand=True)) == 90
