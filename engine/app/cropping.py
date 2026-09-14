"""Stage 3: page plus box in, document-sized image out.

Crops are cut from the ORIGINAL page, never from a downscaled copy: on an A4 scan the card
is about a tenth of the page width and the names stop being readable if the page is shrunk
first. Deskew fires from 10 degrees, a floor that is measured, not chosen.
"""

import logging
from dataclasses import dataclass, replace

import cv2
import numpy as np
from PIL import Image

from .imaging import INVERTED_COVERAGE, OPEN_FRACTION, Page, prepare_frame, saturation_mask
from .orientation import detect_rotation
from .resolution import resample_factor

# The pixel floor for a frame whose dpi is UNKNOWN (resolution.estimate_dpi found no
# physical size to divide by): such a crop is upscaled to this long edge at encode time.
# A frame with a dpi is resampled to config.TARGET_DPI by normalize() and sent at that
# size (encode_floor = 0). Ollama/Qwen re-downscale internally, so cropping tight matters
# more than raw size there; on Anthropic tokens follow the pixels sent.
CROP_MIN_DIM = 1024
CROP_MARGIN = 0.03

# The current sefach sheet is a fixed 2x4 grid: holder blocks on the top row
# (right = identity/address, left = previous names/marital status/spouse),
# six child blocks below. Cells overlap their neighbours by this fraction so a
# slightly loose detector bbox still keeps every value inside its cell.
SEFACH_GRID_COLS, SEFACH_GRID_ROWS = 2, 4
SEFACH_CELL_MARGIN = 0.10
# Margins the holder block is re-read with when it disagrees with the card (see
# rescue_sefach). Measured 2026-09-07 on the A4 scan: 0.05 / 0.15 / 0.20 all fixed the
# shifted names 9/9 while the default margin shifted them 6/6; none fixed the ID.
SEFACH_RESCUE_MARGINS = (0.05, 0.15)
# Older single-page sefach: cut into an upper (identity + address) and a lower (status,
# spouse, nationality, previous names) block — (bottom edge of the upper crop, top edge of
# the lower crop) as fractions of the height; they overlap so a loose cut loses no line.
SEFACH_OLD_SPLIT = (0.58, 0.48)
# The same old layout printed as a two-column 210 x 96 mm strip (measured on the corpus
# strip, 2026-09-10): the holder column on the right from 0.48 of the width, the children
# column on the left with a header row, then four child slots between 0.18 and 0.97 of the
# height. The holder column is read with SEFACH_OLD_SPLIT like the single-column sheet.
SEFACH_STRIP_MIN_ASPECT = 1.8  # a sefach frame this wide is the strip (2.2-2.4), never a sheet (the wallet's old sheet: 1.51)
SEFACH_STRIP_COLUMN = (0.47, 0.50)  # (left edge of the holder column, right edge of the children column): they overlap
# The children column's printed rules measured at 0.22, 0.39, 0.55, 0.72 and 0.89 of the
# height (the holder's ID line sits above the first); four equal rows between them.
SEFACH_STRIP_CHILD_BAND = (0.22, 0.89)
SEFACH_STRIP_CHILD_ROWS = 4
SEFACH_STRIP_ROW_MARGIN = 0.05  # of a row, both ways
# Ink is looked for inside the row only: with the overlap, the last line of a filled slot
# reaches into the next crop and an empty slot was read as a child (invented, no ID).
SEFACH_STRIP_ROW_INK_MARGIN = 0.10
# The account holder's ("drawer") block of a cheque front: the top-RIGHT corner on every
# bank layout in the corpus (Discount, Leumi, Hapoalim), as (width fraction from the right
# edge, height fraction from the top). Measured on the 13 sample cheques 2026-09-10: the block
# ends by 0.31 of the height and starts at 0.47 of the width; the branch block under the logo
# (whose address and phone the whole-front read copies into the drawer fields) ends by 0.37
# of the width, the printed reference line and the handwritten lines lie below 0.40.
CHEQUE_DRAWER_SPAN = (0.60, 0.40)


def crop_region(image: Image.Image, bbox: list[int]) -> Image.Image:
    x1, y1, x2, y2 = bbox
    w, h = image.size
    # Tolerate pixel coords of the detection image if the model ignored normalization
    scale = 1000.0 if max(bbox) <= 1000 else float(max(w, h))
    fx = lambda v: v / scale * w  # noqa: E731
    fy = lambda v: v / scale * h  # noqa: E731
    left, top, right, bottom = fx(x1), fy(y1), fx(x2), fy(y2)
    mx, my = (right - left) * CROP_MARGIN, (bottom - top) * CROP_MARGIN
    box = (
        max(0, int(left - mx)),
        max(0, int(top - my)),
        min(w, int(right + mx)),
        min(h, int(bottom + my)),
    )
    return image.crop(box)


def sefach_cells(sheet: Image.Image, margin: float = SEFACH_CELL_MARGIN) -> list[tuple[int, int, Image.Image]]:
    """Split a sefach sheet into its blocks: (row, col, crop) with col 0 = right
    column (Hebrew reading order), rows top to bottom."""
    w, h = sheet.size
    cw, ch = w / SEFACH_GRID_COLS, h / SEFACH_GRID_ROWS
    m = margin
    cells = []
    for row in range(SEFACH_GRID_ROWS):
        for col in range(SEFACH_GRID_COLS):
            grid_col = SEFACH_GRID_COLS - 1 - col  # col 0 is the rightmost
            box = (
                max(0, int((grid_col - m) * cw)),
                max(0, int((row - m) * ch)),
                min(w, int((grid_col + 1 + m) * cw)),
                min(h, int((row + 1 + m) * ch)),
            )
            cells.append((row, col, sheet.crop(box)))
    return cells


def sefach_old_blocks(sheet: Image.Image) -> tuple[Image.Image, Image.Image]:
    """The older single-page sefach as (upper, lower) crops, see SEFACH_OLD_SPLIT."""
    w, h = sheet.size
    return sheet.crop((0, 0, w, int(h * SEFACH_OLD_SPLIT[0]))), sheet.crop((0, int(h * SEFACH_OLD_SPLIT[1]), w, h))


def sefach_strip_columns(strip: Image.Image) -> tuple[Image.Image, Image.Image]:
    """The two-column strip as (holder column, children column), see SEFACH_STRIP_COLUMN."""
    w, h = strip.size
    return strip.crop((int(w * SEFACH_STRIP_COLUMN[0]), 0, w, h)), strip.crop((0, 0, int(w * SEFACH_STRIP_COLUMN[1]), h))


def sefach_strip_child_rows(column: Image.Image) -> list[Image.Image]:
    """The child slots of the strip's children column, top to bottom, overlapping by
    SEFACH_STRIP_ROW_MARGIN so a loose cut keeps every line inside its row."""
    w, h = column.size
    top, bottom = SEFACH_STRIP_CHILD_BAND
    row_h = (bottom - top) * h / SEFACH_STRIP_CHILD_ROWS
    rows = []
    for i in range(SEFACH_STRIP_CHILD_ROWS):
        y0 = top * h + i * row_h
        pad = SEFACH_STRIP_ROW_MARGIN * row_h
        rows.append(column.crop((0, max(0, int(y0 - pad)), w, min(h, int(y0 + row_h + pad)))))
    return rows


# --------------------------------------------------------------------------- deskew

# Degrees. Measured 2026-09-07: a 6° photocopy read fine as it was and LOST its old-card
# fields once rotated (resampling blur), a 14° scan could not be transcribed until rotated.
# Raised from 10 on 2026-09-10: a straight 150 dpi licence measured 10.5° (its blob is the
# card plus a smudge) and was rotated for nothing; the corpus tilts are 25.7, 13.7, 10.5,
# 6.1 and then <= 4.1, so 12 sits between the false one and the smallest real one. Only a
# clear tilt is worth the blur.
DESKEW_MIN = 12.0
DESKEW_MAX = 30.0  # beyond this the long side is ambiguous (portrait vs landscape)
TILT_MIN_BLOB = 0.05  # the document blob must cover this much of the image to trust its angle


def cheque_drawer_block(front: Image.Image) -> Image.Image:
    """The drawer's block cut from a cheque front, see CHEQUE_DRAWER_SPAN."""
    w, h = front.size
    return front.crop((int(w * (1 - CHEQUE_DRAWER_SPAN[0])), 0, w, int(h * CHEQUE_DRAWER_SPAN[1])))


def tilt_angle(image: Image.Image) -> float:
    """Rotation of the dominant document blob, degrees counter-clockwise (0 when there is
    no blob worth measuring). A phone photo of a card is rarely square to the frame; a
    14° tilt made the 8B model's transcription loop until the token cap."""
    rgb = np.asarray(image.convert("RGB"))
    h, w = rgb.shape[:2]
    mask = saturation_mask(rgb)
    if mask.mean() / 255 > INVERTED_COVERAGE:
        mask = cv2.bitwise_not(mask)
    if mask.mean() / 255 < TILT_MIN_BLOB:  # grey-scale: the document is the minority side of Otsu
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        if mask.mean() / 255 > 0.5:
            mask = cv2.bitwise_not(mask)
    # CLOSE, not OPEN: a greyish card's saturation is speckled and an opening erased it
    # (blob area 0.000 of the crop; closed, 0.485 at the right angle).
    k = max(5, int(min(h, w) * OPEN_FRACTION)) | 1
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0.0
    blob = max(contours, key=cv2.contourArea)
    if cv2.contourArea(blob) < TILT_MIN_BLOB * w * h:
        return 0.0
    points = cv2.boxPoints(cv2.minAreaRect(blob))
    edges = [(points[i], points[(i + 1) % 4]) for i in range(4)]
    (ax, ay), (bx, by) = max(edges, key=lambda e: np.hypot(*(e[1] - e[0])))  # the long side
    angle = float(np.degrees(np.arctan2(by - ay, bx - ax)))
    angle = (angle + 90.0) % 180.0 - 90.0  # into (-90, 90]
    if angle > 45.0:
        angle -= 90.0
    elif angle <= -45.0:
        angle += 90.0
    return -angle  # image y grows downwards, so a visually counter-clockwise tilt has a negative slope


def deskew(image: Image.Image) -> Image.Image:
    """The image rotated square when its document is tilted by DESKEW_MIN..DESKEW_MAX
    degrees; the very same object otherwise."""
    angle = tilt_angle(image)
    if not DESKEW_MIN <= abs(angle) <= DESKEW_MAX:
        return image
    rgb = np.asarray(image.convert("RGB"))
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    fill = tuple(int(v) for v in np.median(border, axis=0))
    return image.convert("RGB").rotate(-angle, expand=True, resample=Image.BICUBIC, fillcolor=fill)


# --------------------------------------------------------------------------- Frame


@dataclass(frozen=True)
class Frame:
    """One document, cut from a Page and prepared for the model.

    Carries its own provenance: rotation, deskew angle, filter names, the estimated dpi
    and the resample factor go to the usage log, so a bad read can be traced to what
    preparation did. No field here is a document value.
    """

    image: Image.Image
    bbox_2d: list[int] | None = None
    label: str | None = None
    rotation: int = 0
    deskewed: float = 0.0
    filters: tuple[str, ...] = ()
    dpi: int | None = None  # estimated source resolution (resolution.estimate_dpi); None = unknown
    resampled: float = 1.0  # factor applied by normalize(); 1.0 = the crop's own pixels


def whole(page: Page, label: str | None) -> Frame:
    """The page as one Frame with the photometric chain only — no deskew, no orientation.
    The Anthropic path's whole-page fallback; why it skips the geometry is measured and
    recorded once, at `pipeline._run`'s `_page_frame`."""
    image, filters = prepare_frame(page.image)
    return Frame(image=image, label=label, filters=filters)


def cut(page: Page, bbox: list[int] | None, label: str | None) -> Frame:
    """Stage 3: crop with a margin, straighten, ask orientation, prepare."""
    image = crop_region(page.image, bbox) if bbox is not None else page.image
    straightened = deskew(image)
    # deskew owns both thresholds and returns the very same object when it declines,
    # so identity is how we learn whether it fired. Do not re-test the angle here:
    # a second threshold would drift from the one that actually rotates the pixels.
    angle = 0.0 if straightened is image else tilt_angle(image)
    rotation = 0
    try:
        # 0 / 90 / 180 / 270 (PIL angles, counter-clockwise), or None for "do not know".
        found = detect_rotation(straightened)
        if found:
            straightened = straightened.rotate(found, expand=True)
            rotation = found
    except Exception:  # noqa: BLE001 - orientation is best-effort, never fatal
        logging.getLogger("makor.usage").warning("orientation check failed; leaving the crop as it is")
    image, filters = prepare_frame(straightened)
    return Frame(image=image, bbox_2d=bbox, label=label, rotation=rotation, deskewed=angle, filters=filters)


def bbox_pixels(size: tuple[int, int], bbox: list[int]) -> tuple[float, float]:
    """A detector box's (width, height) in page pixels — the document's axis-aligned
    size, no crop margin. Same convention as crop_region: 0-1000 coordinates, or pixels
    of the page when the model ignored the normalisation."""
    x1, y1, x2, y2 = bbox
    w, h = size
    if max(bbox) > 1000:  # already pixels
        return float(x2 - x1), float(y2 - y1)
    return (x2 - x1) / 1000.0 * w, (y2 - y1) / 1000.0 * h


def normalize(frame: Frame, dpi: int | None) -> Frame:
    """Stage 3b: the frame resampled to config.TARGET_DPI when its dpi is known (LANCZOS,
    up or down), with the estimate and the factor recorded. The very same object when
    the dpi is unknown, the same pixels when the factor is within RESAMPLE_TOLERANCE."""
    if dpi is None:
        return frame
    factor = resample_factor(dpi)
    if factor == 1.0:
        return replace(frame, dpi=dpi)
    w, h = frame.image.size
    image = frame.image.resize((max(1, round(w * factor)), max(1, round(h * factor))), Image.Resampling.LANCZOS)
    return replace(frame, image=image, dpi=dpi, resampled=factor)


def encode_floor(frame: Frame) -> int:
    """The min_dim for encode_jpeg: none when the frame was normalised by dpi (its size
    IS the size), CROP_MIN_DIM for a frame whose resolution nobody could estimate."""
    return 0 if frame.dpi is not None else CROP_MIN_DIM
