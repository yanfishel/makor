"""Stage 3b: how many dots per inch a Frame carries, and what to do about it.

A file has no physical size and its dpi tag cannot be trusted (most samples carry none),
so resolution is pixels divided by a KNOWN physical width: the classified document's
(an ID-1 card is 85.6 mm long) or, on a full-page scan, the page's (A4 = 297 mm). Pure
functions on numbers; nothing here opens an image or calls a model. Tier 1: imports
config only.
"""

import math

from . import config

# Physical long edges in millimetres.
CARD_MM = 85.6  # ISO/IEC 7810 ID-1: 85.60 x 53.98 (teudat zehut, licence, the cards)
# ID-3 page 125 x 88; a vertical spread (two pages one above the other, how a scanned
# passport lies) is 125 x 176 — the HORIZONTAL edge is 125 mm in both, which is why
# estimate_dpi asks which edge of the frame is horizontal.
PASSPORT_PAGE_MM = 125.0
PASSPORT_SPREAD_MM = 250.0  # a horizontal spread (two pages side by side): 250 x 88
CHEQUE_MM = 160.0  # Israeli bank cheque long edge (the 608 px samples come out at ~97 dpi)
SEFACH_OLD_MM = 210.0  # the older single-page strip is A4-wide
A4_MM = 297.0  # a full-page scan: Letter's 279 mm is a 6 % error, accepted
PAPER_ASPECT = (1.29, 1.45)  # A4 1.414, Letter 1.294: a scanned sheet, not a phone frame
SPREAD_ASPECT = 2.0  # a passport frame wider than this is a horizontal spread
SEFACH_OLD_ASPECT = 1.8  # the strip; the current sheet is squarer and has no fixed size

CARD_KINDS = frozenset({"teudat_zehut", "teudat_zehut_back", "drivers_license", "disability_card",
                        "senior_citizen_card", "weapon_license"})
PASSPORT_KINDS = frozenset({"israeli_passport", "foreign_passport"})
CHEQUE_KINDS = frozenset({"cheque_front", "cheque_back"})

MM_PER_INCH = 25.4


def document_long_edge_px(box_w: float, box_h: float, tilt_deg: float) -> tuple[float, float]:
    """(long, short) edge of the document in pixels from its axis-aligned detector box.
    A rectangle a x b tilted by t sits in a box W = a cos t + b sin t, H = a sin t + b cos t,
    so a = (W cos t - H sin t) / cos 2t and b = (H cos t - W sin t) / cos 2t; deskew never
    fires above 30 degrees (cropping.DESKEW_MAX), where cos 2t is still 0.5."""
    w, h = (box_w, box_h) if box_w >= box_h else (box_h, box_w)
    t = math.radians(abs(tilt_deg))
    if t == 0.0:
        return float(w), float(h)
    c, s, c2 = math.cos(t), math.sin(t), math.cos(2 * t)
    if c2 <= 0.0:
        return float(w), float(h)
    a, b = (w * c - h * s) / c2, (h * c - w * s) / c2
    if a <= 0 or b <= 0:
        return float(w), float(h)
    return (a, b) if a >= b else (b, a)


def _dpi(px: float, mm: float) -> int:
    return round(px / mm * MM_PER_INCH)


def estimate_dpi(
    kind: str | None, sure: bool, doc_px: tuple[float, float], page_px: tuple[int, int],
    is_page: bool, frame_aspect_landscape: bool,
) -> int | None:
    """The frame's resolution, or None when nothing on the page has a known size.

    `doc_px` is (long, short) from document_long_edge_px; `page_px` the Page's (w, h);
    `is_page` whether the frame IS the page (no region, or one box that covers it);
    `frame_aspect_landscape` whether the frame is wider than tall, which for a passport
    says which edge is the 125 mm one.

    The PAGE decides first, whenever the frame is part of a paper-shaped page: measured
    on the corpus (2026-09-10) the page estimate hit 100/150/300 on every scan, while the
    kind estimate ran 2-2.5x high wherever the detector's box is wider than the document
    — a wallet holding two cards in one box, a passport in its plastic cover, the "rest
    of the page" region — and a 2x error resamples a 300 dpi scan down to 100. The kind
    decides only where there is no page: a phone photo, or a frame that IS the page. (A
    4:3 phone photo passes as paper; its page estimate then under-reads a large card,
    which errs towards sending more pixels than TARGET_DPI, never fewer.)"""
    long_px, short_px = doc_px
    if not is_page:
        pw, ph = page_px
        aspect = max(pw, ph) / max(1, min(pw, ph))
        if PAPER_ASPECT[0] <= aspect <= PAPER_ASPECT[1]:
            return _dpi(max(pw, ph), A4_MM)
    if sure and kind is not None:
        if kind in CARD_KINDS:
            return _dpi(long_px, CARD_MM)
        if kind in PASSPORT_KINDS:
            if long_px / max(short_px, 1.0) > SPREAD_ASPECT:
                return _dpi(long_px, PASSPORT_SPREAD_MM)
            return _dpi(long_px if frame_aspect_landscape else short_px, PASSPORT_PAGE_MM)
        if kind in CHEQUE_KINDS:
            return _dpi(long_px, CHEQUE_MM)
        if kind == "sefach" and long_px / max(short_px, 1.0) >= SEFACH_OLD_ASPECT:
            return _dpi(long_px, SEFACH_OLD_MM)
    return None


def resample_factor(dpi: int | None) -> float:
    """TARGET_DPI / dpi, or 1.0 when the dpi is unknown or already close enough."""
    if not dpi:
        return 1.0
    factor = config.TARGET_DPI / dpi
    return 1.0 if abs(factor - 1.0) <= config.RESAMPLE_TOLERANCE else factor


def low_resolution_warning(dpi: int) -> str | None:
    """The client-facing note for a source clearly below WARN_DPI (config.DPI_TOLERANCE
    absorbs the estimate's own coarseness); None otherwise.

    About the IMAGE, not a region: every crop is cut from one upload and the page-first
    estimate gives them all the same number, so a note per region said the same thing two or
    three times over. The caller passes the lowest estimate on the page — that is the one
    that limits what can be read."""
    if dpi >= config.WARN_DPI * (1.0 - config.DPI_TOLERANCE):
        return None
    # What was measured and why it matters — nothing about what the pipeline did with it
    # (the upscale to TARGET_DPI is the engine's business, not a fact about the document).
    return f"The image is about {dpi} dpi — below the recommended {config.WARN_DPI} dpi"
