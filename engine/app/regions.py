"""Classical (OpenCV) document detection — finds the documents on a page without a model call.

The pipeline asks here first and falls back to the vision model's detector only when
nothing is found. Two passes:

1. **Colour**: Israeli documents are printed on tinted paper (the card is blue, the
   sefach carries a pale blue guilloche) while a scanner lid / desk is grey, so a
   threshold on the HSV saturation channel separates them cleanly; when the mask
   covers most of the image the roles are reversed (a pale card photographed on a
   coloured tablecloth) and the un-saturated blob is the document. Verified on the
   A4 scan: the sefach box lands within a few pixels of the model's box, but with no
   run-to-run jitter (the model's ±4 px moved the sefach grid by one block).
2. **Edges** (when the colour pass finds nothing — grey-scale scans, photocopies): Canny
   edges. A cheque scan is the common case here: a wide, ruled front on top and a
   mostly blank back below it. The back has no edge of its own against the white
   background, so the front is cut where its full-width rows end (ruled lines, the
   MICR line and the paper border all span most of the width; a stamp or an
   endorsement on the back never does — measured on 13 scans: the cut lands at
   503–512/1000 on every front+back scan and at 961–993 on every front-only one) and
   the back is "the rest of the page", kept only when that strip carries ink. Other
   grey-scale pages get plain contour boxes.

Labels are geometric and deliberately conservative: a wide box is a cheque front, a
large pale portrait box inside a page is a sefach (pale matters: a passport page
photocopied onto A4 has the same size and shape but is full of print), everything else
is ``None`` and goes down the generic identity schema (a wrong label would cost a
repeated model call; ``None`` costs nothing). Boxes are ``[x1, y1, x2, y2]`` normalised
to 0-1000 like the model's.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

from .imaging import INVERTED_COVERAGE, OPEN_FRACTION, has_ink, saturation_mask

CANNY_LOW, CANNY_HIGH = 30, 90
MIN_AREA = 0.01  # a box below 1% of the page is noise (a staple, a smudge)
WHOLE_IMAGE_AREA = 0.8  # a single box this big means the image already is the document
# Width / height; a cheque is ~2.3, cards ~1.6, sheets < 1. A scan cropped tight at the
# sides shrinks the front's aspect to ~1.6 and stays unlabelled ON PURPOSE: labelling it
# by its dense ruling was tried (2026-09-07) and the front crop then looped until the
# token cap at every scale (6/6), while the uncropped page reads fine via the generic path.
CHEQUE_MIN_ASPECT = 1.8
SEFACH_MIN_AREA = 0.25  # the sheet is many times bigger than a card
SEFACH_ASPECT = (0.55, 0.95)  # portrait
# The old two-column sefach is a 210 x 96 mm strip: a cheque's shape on a sheet's paper.
# Measured 2026-09-10: the strip's mean grey 244 against 134-174 for every cheque front in
# the corpus, so paleness tells them apart; the aspect band stops short
# of the text-page strips (4.2-4.8) the geometry gate rejects anyway.
SEFACH_STRIP_ASPECT = (CHEQUE_MIN_ASPECT, 2.6)
SEFACH_STRIP_MIN_AREA = 0.18  # the strip boxed tight measures 0.205 of the A4 (0.30 boxed loose); the text-page strips 0.13-0.15
SEFACH_MIN_BRIGHTNESS = 230  # mean grey of the sheet: mostly white paper (measured 251; passport pages 200-209)
SEFACH_MAX_DARK = 0.05  # fraction of pixels darker than DARK_LEVEL (measured 0.009; passports 0.15-0.31)
DARK_LEVEL = 160
COLOUR_CLOSE_FRACTION = 0.015  # closing kernel as a fraction of the short side; bigger merges a card into the sheet 24 px below it
EDGE_CLOSE = (0.05, 0.03)  # (width, height) fractions: text runs horizontally, so link words before lines
ROW_COVERAGE = 0.5  # a row whose edges span this much of the width belongs to the cheque front
ROW_ANY = 0.03  # a row / column with at least this much edge is content, not noise
FRONT_MARGIN = 0.01  # of the height, added below the last full-width row
MIN_BACK_HEIGHT = 0.1  # of the height; anything shorter is not a back
# Documents that touch each other inside one tinted blob (two papers in a blue plastic
# wallet) are told apart by their paper: bright islands inside the blob. Measured on the
# wallet scan: paper grey median 205, plastic 95-132.
SPLIT_MIN_AREA = 0.15  # only blobs this big (of the page) are worth splitting
PAPER_LEVEL = 170  # grey above which a pixel is paper, not plastic
ISLAND_MIN = 0.10  # an island below this fraction of the blob is a label or a photo, not a document
ISLAND_MAX = 0.70  # an island above this IS the blob (a passport spread): do not split
# Documents in a wallet fill most of it (the corpus wallet: 0.71 of the blob); a passport
# spread with a sticky note on one page and a pale patch on the other gave two islands
# covering 0.43 and, split, lost the photo and the MRZ (2026-09-10). Below this the blob stays.
ISLAND_COVERAGE_MIN = 0.60
ISLAND_OVERLAP = 0.05  # islands overlapping more than this (of the smaller) are one thing
# The strip below a cheque front is judged on its inner part: a scanner's dark side margins
# counted as ink (0.011 on a blank back; 0 with the margin), real stamps keep 0.023-0.038.
BACK_INK_MARGIN = 0.10

Box = tuple[int, int, int, int]  # pixel (x1, y1, x2, y2)


@dataclass(frozen=True)
class LocalRegion:
    label: str | None
    bbox_2d: list[int]


def detect_regions_local(image: Image.Image) -> list[LocalRegion]:
    rgb = np.asarray(image.convert("RGB"))
    h, w = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = _edge_mask(gray)

    mask = saturation_mask(rgb)
    colour = _boxes(mask, COLOUR_CLOSE_FRACTION)
    if mask.mean() / 255 > INVERTED_COVERAGE:
        # A pale document on a coloured background: look for the UN-saturated blob instead
        # (a tinted document filling the whole frame has none, and keeps its whole-image box).
        # A background SURROUNDS its document, so an un-saturated blob that reaches the
        # frame edge is background itself, not a card lying on it: a phone photo of a
        # passport on a light desk (desk S 26 — tinted to the threshold) had the desk's
        # un-tinted part run out to the left edge, and taking it as the document cut the
        # passport's right column off (measured 2026-09-10). Without such a blob the
        # edge pass below finds the document's outline.
        k = max(5, int(min(h, w) * OPEN_FRACTION)) | 1
        inverted = cv2.morphologyEx(cv2.bitwise_not(mask), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
        colour = [b for b in _boxes(inverted, COLOUR_CLOSE_FRACTION) if not _touches_edge(b, w, h)] or colour
    # A single page-sized colour box is either a photo of one document or a colour scan
    # of grey content (a cheque with a colour cast): let the edge pass try to split it.
    if colour and not (len(colour) == 1 and _area(colour[0], w, h) >= WHOLE_IMAGE_AREA):
        colour = [sub for box in colour for sub in _split_merged(box, gray)]
        if _label(colour[0], gray) == "cheque_front":
            return _cheque_scan(gray, edges) or _regions(colour, gray)
        return _regions(colour, gray)
    cheque = _cheque_scan(gray, edges)
    if cheque:
        return cheque
    edge_boxes = _boxes(edges, EDGE_CLOSE)
    if edge_boxes:
        return _regions(edge_boxes, gray)
    return _regions(colour, gray)


# --------------------------------------------------------------------------- masks


def _edge_mask(gray: np.ndarray) -> np.ndarray:
    return cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), CANNY_LOW, CANNY_HIGH)


# --------------------------------------------------------------------------- boxes


def _boxes(mask: np.ndarray, close: float | tuple[float, float]) -> list[Box]:
    """Pixel boxes of the blobs in ``mask``, top to bottom, nested ones dropped."""
    h, w = mask.shape
    fx, fy = (close, close) if isinstance(close, float) else close
    kernel = (max(5, int(w * fx)) | 1, max(5, int(h * fy)) | 1)
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, kernel))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours:
        x, y, bw, bh = cv2.boundingRect(contour)
        if bw * bh >= MIN_AREA * w * h:
            boxes.append((x, y, x + bw, y + bh))
    boxes = [b for b in boxes if not any(o != b and _contains(o, b) for o in boxes)]
    return sorted(boxes, key=lambda b: (b[1], b[0]))


def _cheque_scan(gray: np.ndarray, edges: np.ndarray) -> list[LocalRegion] | None:
    """Front (+ back) of a cheque scan, or None when the page has no wide ruled document."""
    h, w = gray.shape
    spread = cv2.dilate(edges, np.ones((5, 1), np.uint8)) > 0  # a ruled line = 2 edge rows; widen them
    row_coverage = spread.mean(axis=1)
    full_rows = np.flatnonzero(row_coverage >= ROW_COVERAGE)
    if len(full_rows) == 0:
        return None
    bottom = min(h, int(full_rows.max() + FRONT_MARGIN * h) + 1)
    band = spread[:bottom]
    rows = np.flatnonzero(band.mean(axis=1) >= ROW_ANY)
    cols = np.flatnonzero(band.mean(axis=0) >= ROW_ANY)
    if len(rows) == 0 or len(cols) == 0:
        return None
    front: Box = (int(cols.min()), int(rows.min()), int(cols.max()) + 1, bottom)
    if _label(front, gray) != "cheque_front":
        return None
    regions = [(front, "cheque_front")]
    if h - bottom >= MIN_BACK_HEIGHT * h and has_ink(gray[bottom:, :], BACK_INK_MARGIN):
        # A back is the front's shape (corpus backs: aspect 2.16-2.24). A tall rest of the
        # page holding ink is some other document under a cheque: unlabelled, so the
        # classifier looks at it instead of inheriting "cheque_back" without a call.
        rest: Box = (0, bottom, w, h)
        regions.append((rest, "cheque_back" if _aspect(rest) >= CHEQUE_MIN_ASPECT else None))
    return [LocalRegion(label, _normalise(box, w, h)) for box, label in regions]


def _split_merged(box: Box, gray: np.ndarray) -> list[Box]:
    """The paper islands inside a large tinted blob when there are several of them (two
    documents in one wallet); otherwise the blob itself."""
    h, w = gray.shape
    if _area(box, w, h) < SPLIT_MIN_AREA or _label(box, gray) is not None:
        return [box]
    x1, y1, x2, y2 = box
    crop = gray[y1:y2, x1:x2]
    _, paper = cv2.threshold(crop, PAPER_LEVEL, 255, cv2.THRESH_BINARY)
    k = max(5, int(min(crop.shape) * OPEN_FRACTION)) | 1
    paper = cv2.morphologyEx(paper, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    blob_area = crop.shape[0] * crop.shape[1]
    islands = [(x1 + a, y1 + b, x1 + c, y1 + d) for a, b, c, d in _boxes(paper, COLOUR_CLOSE_FRACTION)
               if (c - a) * (d - b) >= ISLAND_MIN * blob_area]
    if len(islands) < 2 or any((c - a) * (d - b) > ISLAND_MAX * blob_area for a, b, c, d in islands):
        return [box]
    if sum((c - a) * (d - b) for a, b, c, d in islands) < ISLAND_COVERAGE_MIN * blob_area:
        return [box]
    for i, a in enumerate(islands):
        for b in islands[i + 1:]:
            if _overlap(a, b) > ISLAND_OVERLAP:
                return [box]
    return sorted(islands, key=lambda b: (b[1], b[0]))


def _overlap(a: Box, b: Box) -> float:
    """Intersection as a fraction of the smaller box."""
    iw = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    ih = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return iw * ih / smaller if smaller else 0.0


def _touches_edge(box: Box, w: int, h: int) -> bool:
    return box[0] == 0 or box[1] == 0 or box[2] == w or box[3] == h


def _contains(outer: Box, inner: Box) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]


def _area(box: Box, w: int, h: int) -> float:
    return (box[2] - box[0]) * (box[3] - box[1]) / (w * h)


def _aspect(box: Box) -> float:
    return (box[2] - box[0]) / max(1, box[3] - box[1])


# --------------------------------------------------------------------------- labels


def _is_pale(box: Box, gray: np.ndarray) -> bool:
    """Mostly white paper with little print: a sefach sheet, never a cheque or a passport page."""
    crop = gray[box[1]:box[3], box[0]:box[2]]
    return crop.mean() >= SEFACH_MIN_BRIGHTNESS and float(np.mean(crop < DARK_LEVEL)) <= SEFACH_MAX_DARK


def _label(box: Box, gray: np.ndarray) -> str | None:
    h, w = gray.shape
    aspect, area = _aspect(box), _area(box, w, h)
    if aspect >= CHEQUE_MIN_ASPECT:
        if area >= SEFACH_STRIP_MIN_AREA and aspect <= SEFACH_STRIP_ASPECT[1] and _is_pale(box, gray):
            return "sefach"  # the old two-column strip, see SEFACH_STRIP_ASPECT
        return "cheque_front"
    if area >= WHOLE_IMAGE_AREA:
        return None
    if area >= SEFACH_MIN_AREA and SEFACH_ASPECT[0] <= aspect <= SEFACH_ASPECT[1] and _is_pale(box, gray):
        return "sefach"
    return None


def _regions(boxes: list[Box], gray: np.ndarray) -> list[LocalRegion]:
    h, w = gray.shape
    return [LocalRegion(_label(box, gray), _normalise(box, w, h)) for box in boxes]


def _normalise(box: Box, w: int, h: int) -> list[int]:
    x1, y1, x2, y2 = box
    return [round(1000 * x1 / w), round(1000 * y1 / h), round(1000 * x2 / w), round(1000 * y2 / h)]
