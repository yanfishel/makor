"""Stage 1: pixels in, pixels out.

Two phases, and the split is not cosmetic. `prepare_page` runs before region detection and
may only touch geometry, because `regions.py` thresholds saturation, brightness and ink
against values measured on untouched scans. `prepare_frame` runs after cropping, per
region, and owns scale, photometry and the JPEG encode.
"""

import base64
import io
from collections.abc import Callable
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps

from . import config

# Printed values are black on a pale form: a region with fewer dark pixels than this
# fraction is unused (a blank sefach block, a blank cheque back) and is not sent to the
# model. Shared by both callers: the sefach grid reader (whole cell, no margin) and the
# cheque-back detector (margin trims a scanner's dark side margins, which otherwise read
# as ink on a blank back).
INK_LEVEL = 90  # grey level below which a pixel is ink
INK_FRACTION = 0.001

# Shared by region detection (regions.py) and tilt measurement (cropping.py): both need the
# same "is this pixel tinted document paper" mask, so it lives here rather than in either.
SATURATION_MIN = 20  # HSV S (0-255) above which a pixel counts as "tinted paper"
# Saturation mask covering more than this = the BACKGROUND is the tinted part (a card on a
# tablecloth; scans measure 0-0.23, the phone photo 0.82).
INVERTED_COVERAGE = 0.5
# Morphological kernel size, as a fraction of the image's short side: an opening in region
# detection (removes fabric-texture speckles from the inverted mask) and a closing in tilt
# measurement (a greyish card's saturation is speckled and an opening erased it — blob area
# 0.000 of the crop; closed, 0.485 at the right angle).
OPEN_FRACTION = 0.02


Image.MAX_IMAGE_PIXELS = config.MAX_DECODE_PIXELS

PDF_MAGIC = b"%PDF"


def _render_pdf(raw: bytes) -> tuple[Image.Image, tuple[str, ...]]:
    """The first page of a PDF as an RGB image at PDF_RENDER_DPI, plus a note when the
    file has more pages: the API describes one page, a client sends the next one itself."""
    import pypdfium2 as pdfium  # imported here: the PDF path is the rare one
    import pypdfium2.raw as pdfium_c

    document = pdfium.PdfDocument(raw)
    try:
        pages = len(document)
        if pages == 0:
            raise ValueError("PDF has no pages")
        page = document[0]
        scan = _pdf_scan(page, pdfium_c.FPDF_PAGEOBJ_IMAGE)
        if scan is not None:
            # The embedded scan's own pixels (render=False: pdfium's own image render
            # rounds the size up and resamples), turned the way its matrix places them and
            # then the way the page's own /Rotate turns the whole sheet — rendering applies
            # that attribute, taking the pixels does not, and a viewer shows it turned.
            image = _turn_scan(scan.get_bitmap(render=False).to_pil().convert("RGB"), scan.get_matrix().get())
            rotation = page.get_rotation() % 360
            if rotation:
                image = image.rotate(-rotation, expand=True)  # PIL turns anticlockwise, /Rotate is clockwise
        else:
            image = page.render(scale=config.PDF_RENDER_DPI / 72).to_pil().convert("RGB")
    finally:
        document.close()
    notes = (f"{pages - 1} more page(s) in the PDF were not read",) if pages > 1 else ()
    return image, notes


# A page whose one image covers this much of it is a scan: that image is taken as it is,
# pixel for pixel. Rendered at a fixed 200 dpi instead, a ~100 dpi A4 scan came out doubled
# and the 2x upscale lost a letter of the card's family name 2/2; rendered at the scan's own
# scale, pdfium still resampled it (mean 1.0, max 105 levels off) and that alone flipped the
# sefach holder's ID 2/2 (2026-09-10). Pages without such an image (text, vector) render at
# PDF_RENDER_DPI.
PDF_SCAN_COVERAGE = 0.8


def _pdf_scan(page, image_type: int):
    """The page-covering image object of a scanned PDF page, or None."""
    page_w, page_h = page.get_size()
    for obj in page.get_objects():
        if obj.type != image_type:
            continue
        x1, y1, x2, y2 = obj.get_bounds()  # points: left, bottom, right, top
        if (x2 - x1) * (y2 - y1) >= PDF_SCAN_COVERAGE * page_w * page_h:
            return obj
    return None


# How the image's own axes land on the SCREEN (x right, y down) decides the turn, and all
# eight of the square's symmetries occur: a scanner's landscape page arrives quarter-turned,
# and a writer that stores the rows bottom-up places them with a negative d (a corpus PDF
# placed its scan [850 0 0 -1170 0 1170] — upside down for the model until 2026-09-12).
_TURNS: dict[tuple[tuple[int, int], tuple[int, int]], Image.Transpose | None] = {
    ((1, 0), (0, 1)): None,
    ((1, 0), (0, -1)): Image.Transpose.FLIP_TOP_BOTTOM,
    ((-1, 0), (0, 1)): Image.Transpose.FLIP_LEFT_RIGHT,
    ((-1, 0), (0, -1)): Image.Transpose.ROTATE_180,
    ((0, -1), (1, 0)): Image.Transpose.ROTATE_90,
    ((0, 1), (-1, 0)): Image.Transpose.ROTATE_270,
    ((0, 1), (1, 0)): Image.Transpose.TRANSPOSE,
    ((0, -1), (-1, 0)): Image.Transpose.TRANSVERSE,
}


def _axis(value: float) -> int:
    return 0 if abs(value) < 1e-6 else (1 if value > 0 else -1)


def _turn_scan(image: Image.Image, matrix: tuple[float, ...]) -> Image.Image:
    """Place an embedded scan the way its PDF matrix (a, b, c, d, e, f) does. The unit square
    maps (x, y) -> (a·x + c·y + e, b·x + d·y + f) in page space (y UP), and the image's first
    row sits at y = 1, so one step right along the pixels is (a, b) and one step DOWN is
    (-c, -d) — on screen, where y points the other way, (a, -b) and (-c, d). A matrix that is
    not axis-aligned (a real rotation) is left alone: there is no square turn for it."""
    a, b, c, d = matrix[:4]
    op = _TURNS.get(((_axis(a), _axis(-b)), (_axis(-c), _axis(d))))
    return image if op is None else image.transpose(op)


def _fit_page(image: Image.Image) -> Image.Image:
    """Downscale so the long edge fits MAX_PAGE_DIMENSION (geometry only, LANCZOS)."""
    w, h = image.size
    cap = config.MAX_PAGE_DIMENSION
    if max(w, h) <= cap:
        return image
    scale = cap / max(w, h)
    return image.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)


def load_document(raw: bytes) -> tuple[Image.Image, tuple[str, ...]]:
    """Decode an upload (image or PDF) into an RGB page within the ingest cap, with any
    notes about what was not read. JPEGs decode at reduced scale (`draft`) so a 30 MB
    photo never materialises at full size."""
    if raw.startswith(PDF_MAGIC):
        image, notes = _render_pdf(raw)
        return _fit_page(image), notes
    image = Image.open(io.BytesIO(raw))
    if image.format == "JPEG":
        image.draft("RGB", (config.MAX_PAGE_DIMENSION, config.MAX_PAGE_DIMENSION))
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")
    return _fit_page(image), ()


def load_image(raw: bytes) -> Image.Image:
    return load_document(raw)[0]


@dataclass(frozen=True)
class Page:
    """The upload after geometric-only preparation.

    Pixel values are untouched on purpose: regions.py thresholds saturation, brightness
    and ink against numbers measured on raw scans, so any photometric filter applied here
    would invalidate all of them at once. Photometry belongs on a Frame.
    """

    image: Image.Image
    warnings: tuple[str, ...] = ()  # what the decoder left unread (a PDF's further pages)


def prepare_page(raw: bytes) -> Page:
    """Stage 1: decode, honour EXIF rotation, force RGB. Nothing else."""
    image, notes = load_document(raw)
    return Page(image=image, warnings=notes)


# Photometric filters, applied in order to every cut region. This tuple is empty until a
# candidate proves itself: a filter ships only when it makes at least one field read
# correctly that did not before, or removes a token-cap hit, or saves time with no change
# in fields — and only when no field that reads correctly today becomes wrong or empty. A
# candidate that fails is deleted outright, not left switched off, so a later session
# cannot re-enable it without repeating the measurement.
#
# has_ink() below is itself a measured pixel threshold (ink level 90, fraction 0.001), and
# its three call sites in the sefach grid reader (backend_ollama.py) run on a Frame's
# image — downstream of this filter chain, not upstream like regions.py. So a new filter
# must also be checked against has_ink before it ships: has_ink decides whether a sefach
# block is blank and therefore whether it is sent to the model at all. Getting that wrong
# in the direction of "sees more ink" costs extra model calls; getting it wrong the other
# way silently skips a faintly printed block and a child disappears from the output with
# no warning.
FILTERS: tuple[tuple[str, Callable[[Image.Image], Image.Image]], ...] = ()


def prepare_frame(image: Image.Image) -> tuple[Image.Image, tuple[str, ...]]:
    """Stage 3d: run the photometric filter chain on a cut region. Returns the image and
    the names of the filters that ran (in FILTERS order), so a bad read can be traced to
    what preparation did without re-running anything.

    Scale is not this function's job: the upscale for a small crop happens once, at encode
    time, in `encode_jpeg`'s own `min_dim`. Do not add a second resize here — it would
    double-resample a small crop at a different ratio than the one the reading layer
    actually uses."""
    prepared = image
    for _, filter_fn in FILTERS:
        prepared = filter_fn(prepared)
    return prepared, tuple(name for name, _ in FILTERS)


def encode_jpeg(image: Image.Image, max_dim: int, min_dim: int = 0) -> str:
    img = image.copy()
    if min_dim and max(img.size) < min_dim:
        scale = min_dim / max(img.size)
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    img.thumbnail((max_dim, max_dim))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=config.JPEG_QUALITY)
    return base64.standard_b64encode(buffer.getvalue()).decode("utf-8")


def has_ink(source: Image.Image | np.ndarray, margin: float = 0.0) -> bool:
    """True when the inner region carries printed (dark) values, not just paper or pale labels.

    `margin` trims that fraction off each side first: a scanner's dark side margins
    otherwise read as ink on a blank cheque back. Real guarantee stamps measure
    0.023-0.038 of the inner area, blank backs measure 0. Accepts either a Pillow image
    (the sefach grid reader's whole cell) or a grey NumPy array (the cheque-back
    detector's strip); both callers share INK_LEVEL and INK_FRACTION.
    """
    if isinstance(source, Image.Image):
        gray = np.array(source.convert("L"))
    else:
        gray = source
    h, w = gray.shape[:2]
    inner = gray[int(h * margin):h - int(h * margin), int(w * margin):w - int(w * margin)]
    return inner.size > 0 and float(np.mean(inner < INK_LEVEL)) >= INK_FRACTION


def saturation_mask(rgb: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    _, mask = cv2.threshold(hsv[:, :, 1], SATURATION_MIN, 255, cv2.THRESH_BINARY)
    return mask
