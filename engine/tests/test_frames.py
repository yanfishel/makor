"""Page and Frame carry the stage contract in the type, and Frame records what
preparation did to it so the usage log can report it without re-running anything."""
import io
from dataclasses import FrozenInstanceError

import pytest
from PIL import Image, UnidentifiedImageError

from app.cropping import Frame, cut
from app.imaging import Page, prepare_page


def _png(width: int = 400, height: int = 300, colour=(255, 255, 255)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def test_prepare_page_returns_a_page_in_rgb():
    page = prepare_page(_png())
    assert isinstance(page, Page)
    assert page.image.mode == "RGB"
    assert page.image.size == (400, 300)


def test_prepare_page_rejects_a_non_image():
    with pytest.raises(UnidentifiedImageError):
        prepare_page(b"not an image at all")


def test_cut_without_a_bbox_keeps_the_whole_page():
    page = prepare_page(_png())
    frame = cut(page, None, None)
    assert isinstance(frame, Frame)
    assert frame.bbox_2d is None
    assert frame.image.size == page.image.size


def test_cut_with_a_bbox_records_where_it_came_from():
    page = prepare_page(_png(1000, 1000))
    frame = cut(page, [100, 100, 500, 400], "sefach")
    assert frame.bbox_2d == [100, 100, 500, 400]
    assert frame.label == "sefach"
    # the box is 400x300 plus an equal 3% margin on each side, so the aspect survives
    assert frame.image.size[0] / frame.image.size[1] == pytest.approx(4 / 3, abs=0.02)
    assert frame.image.size[0] < page.image.size[0]


def test_a_fresh_frame_reports_no_preparation():
    frame = cut(prepare_page(_png()), None, None)
    assert frame.rotation == 0
    assert frame.deskewed == 0.0
    assert frame.filters == ()


def test_frame_is_immutable():
    frame = cut(prepare_page(_png()), None, None)
    with pytest.raises(FrozenInstanceError):
        frame.rotation = 180


"""cut asks the orientation stage and records what it did. The classifier is stubbed here:
the real one needs the ONNX models, and its gate is tested in test_orientation.py."""
from app import cropping  # noqa: E402


def test_cut_rotates_when_orientation_says_one_eighty(monkeypatch):
    monkeypatch.setattr(cropping, "detect_rotation", lambda image: 180)
    page = prepare_page(_png(600, 400))
    frame = cut(page, None, None)
    assert frame.rotation == 180


def test_cut_leaves_the_crop_alone_when_orientation_abstains(monkeypatch):
    monkeypatch.setattr(cropping, "detect_rotation", lambda image: None)
    frame = cut(prepare_page(_png(600, 400)), None, None)
    assert frame.rotation == 0


def test_cut_leaves_the_crop_alone_when_orientation_says_upright(monkeypatch):
    monkeypatch.setattr(cropping, "detect_rotation", lambda image: 0)
    frame = cut(prepare_page(_png(600, 400)), None, None)
    assert frame.rotation == 0


def test_orientation_failure_does_not_fail_the_cut(monkeypatch):
    def boom(image):
        raise RuntimeError("onnx session died")

    monkeypatch.setattr(cropping, "detect_rotation", boom)
    frame = cut(prepare_page(_png(600, 400)), None, None)
    assert frame.rotation == 0


# --------------------------------------------------------------------------- ingest cap and PDF

def _pdf(pages: int, size=(595, 842)) -> bytes:
    """A PDF of `pages` white A4 pages at 72 dpi, written by Pillow."""
    buffer = io.BytesIO()
    first, *rest = [Image.new("RGB", size, "white") for _ in range(pages)]
    first.save(buffer, format="PDF", save_all=True, append_images=rest)
    return buffer.getvalue()


def test_prepare_page_caps_the_long_edge_at_the_ingest_limit():
    from app import config

    page = prepare_page(_png(5000, 3000))
    assert page.image.size == (config.MAX_PAGE_DIMENSION, round(config.MAX_PAGE_DIMENSION * 3000 / 5000))
    assert page.warnings == ()


def test_prepare_page_leaves_a_page_under_the_cap_alone():
    assert prepare_page(_png(2000, 1500)).image.size == (2000, 1500)


def test_prepare_page_renders_the_first_pdf_page_as_rgb():
    # Pillow's PDF embeds the image as one page-covering scan: rendered at its own pixels.
    page = prepare_page(_pdf(1))
    assert page.image.mode == "RGB"
    assert abs(page.image.size[0] - 595) <= 2 and abs(page.image.size[1] - 842) <= 2
    assert page.warnings == ()


def test_prepare_page_reads_only_the_first_pdf_page_and_says_so():
    page = prepare_page(_pdf(3))
    assert page.warnings == ("2 more page(s) in the PDF were not read",)


def test_prepare_page_rejects_a_broken_pdf():
    from pypdfium2 import PdfiumError

    with pytest.raises(PdfiumError):
        prepare_page(b"%PDF-1.4 not really a pdf")


def test_a_scanned_pdf_is_rendered_at_the_scans_own_resolution():
    # A PDF holding one 850x1170 scan on an A4 page (~100 dpi): rendered at the fixed
    # 200 dpi it came out doubled, and the 2x upscale lost a letter of the card's family
    # name 2/2 (2026-09-10) — the same collapse a 2x JPEG upscale causes. The scan's own
    # pixels are what a JPEG upload would have been.
    buffer = io.BytesIO()
    Image.new("RGB", (850, 1170), "white").save(buffer, format="PDF", resolution=100)
    page = prepare_page(buffer.getvalue())
    assert page.image.size == (850, 1170)  # exactly: pdfium rounds the render up by a pixel, and that
    # one pixel resamples the whole page — enough to flip the sefach holder's ID (2/2, 2026-09-10)


def test_a_pdf_without_images_is_rendered_at_the_ingest_dpi():
    import pypdfium2 as pdfium

    from app import config

    document = pdfium.PdfDocument.new()
    document.new_page(595, 842)
    page = prepare_page(document.save_to_bytes() if hasattr(document, "save_to_bytes") else _pdf_bytes(document))
    assert abs(page.image.size[1] - round(842 * config.PDF_RENDER_DPI / 72)) <= 2


def _pdf_bytes(document) -> bytes:
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def test_a_scanned_pdf_yields_the_embedded_scans_pixels_exactly():
    # Rendering the page resamples even at the scan's own scale (mean 1.0, max 105 levels
    # off on the reference A4 scan) and that alone flipped the sefach holder's ID 2/2; the
    # embedded image is taken as it is, its placement matrix honoured.
    import numpy as np
    import pypdfium2 as pdfium

    rng = np.random.default_rng(0)
    w, h = 850, 1170  # the reference A4 scan's geometry: 842.4 pt x 1.3889 lands a hair over 1170
    pixels = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
    scan = Image.fromarray(pixels, "RGB")
    document = pdfium.PdfDocument.new()
    page = document.new_page(w * 72 / 100, h * 72 / 100)
    image = pdfium.PdfImage.new(document)
    image.set_bitmap(pdfium.PdfBitmap.from_pil(scan))
    image.set_matrix(pdfium.PdfMatrix().scale(w * 72 / 100, h * 72 / 100))
    page.insert_obj(image)
    page.gen_content()
    result = prepare_page(_pdf_bytes(document))
    assert result.image.size == (w, h)
    assert np.array_equal(np.asarray(result.image), pixels)


def test_a_rotated_scan_in_a_pdf_comes_out_the_way_the_page_shows_it():
    # A landscape scan placed on its page with a 90-degree matrix (scanners do that): the
    # embedded pixels are taken as they are and turned as the page shows them — the page
    # render is the oracle for the direction.
    import numpy as np
    import pypdfium2 as pdfium

    rng = np.random.default_rng(1)
    w, h = 300, 200  # the scan is landscape ...
    pixels = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
    document = pdfium.PdfDocument.new()
    page = document.new_page(h, w)  # ... on a portrait page, in points, 72 dpi
    image = pdfium.PdfImage.new(document)
    image.set_bitmap(pdfium.PdfBitmap.from_pil(Image.fromarray(pixels, "RGB")))
    image.set_matrix(pdfium.PdfMatrix(0, w, -h, 0, h, 0))  # x -> up, y -> left: rotated a quarter turn
    page.insert_obj(image)
    page.gen_content()
    raw = _pdf_bytes(document)
    oracle = pdfium.PdfDocument(raw)[0].render(scale=1).to_pil().convert("RGB")
    result = prepare_page(raw)
    assert result.image.size == oracle.size == (h, w)
    assert np.abs(np.asarray(result.image).astype(int) - np.asarray(oracle).astype(int)).mean() < 3
    assert np.array_equal(np.asarray(result.image), np.rot90(pixels, 1)) or np.array_equal(np.asarray(result.image), np.rot90(pixels, -1))


def _scanned_pdf(pixels, matrix, rotation=0) -> bytes:
    """A one-page PDF holding `pixels` as its only image, placed by `matrix`, at 72 dpi."""
    import pypdfium2 as pdfium

    h, w = pixels.shape[:2]
    document = pdfium.PdfDocument.new()
    page = document.new_page(w, h)
    image = pdfium.PdfImage.new(document)
    image.set_bitmap(pdfium.PdfBitmap.from_pil(Image.fromarray(pixels, "RGB")))
    image.set_matrix(matrix)
    page.insert_obj(image)
    page.gen_content()
    if rotation:
        page.set_rotation(rotation)
    return _pdf_bytes(document)


def test_a_scan_stored_bottom_up_is_flipped_the_way_the_page_shows_it():
    # A corpus PDF places its scan with a negative d ([850 0 0 -1170 0 1170]): the rows are
    # stored bottom-up and the matrix turns them over. Taken as they were, the page reached the
    # model upside down and the 8B model invented most of a teudat zehut (2026-09-12).
    import numpy as np
    import pypdfium2 as pdfium

    rng = np.random.default_rng(3)
    w, h = 300, 200
    pixels = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
    raw = _scanned_pdf(pixels, pdfium.PdfMatrix(w, 0, 0, -h, 0, h))
    oracle = pdfium.PdfDocument(raw)[0].render(scale=1).to_pil().convert("RGB")
    result = prepare_page(raw)
    assert np.array_equal(np.asarray(result.image), np.flipud(pixels))
    assert np.abs(np.asarray(result.image).astype(int) - np.asarray(oracle).astype(int)).mean() < 3


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_the_pages_own_rotate_turns_the_extracted_scan(rotation):
    # /Rotate is the sheet's own quarter turn: rendering applies it, taking the embedded
    # pixels does not — so a scan that a viewer shows upright arrived turned.
    import numpy as np
    import pypdfium2 as pdfium

    rng = np.random.default_rng(4)
    w, h = 300, 200
    pixels = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
    raw = _scanned_pdf(pixels, pdfium.PdfMatrix().scale(w, h), rotation=rotation)
    oracle = pdfium.PdfDocument(raw)[0].render(scale=1).to_pil().convert("RGB")
    result = prepare_page(raw)
    assert result.image.size == oracle.size
    assert np.array_equal(np.asarray(result.image), np.rot90(pixels, -rotation // 90))
    assert np.abs(np.asarray(result.image).astype(int) - np.asarray(oracle).astype(int)).mean() < 3


def test_a_scan_at_200_dpi_in_a_pdf_keeps_its_exact_pixels_too():
    # 1920 px at 200 dpi is 691.2 pt; mapped back, pdfium's own image render rounds to 1921
    # rows and resamples every row (mean 1.7, max 118 levels off on the passport PDF).
    import numpy as np
    import pypdfium2 as pdfium

    rng = np.random.default_rng(2)
    w, h = 1080, 1920
    pixels = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
    document = pdfium.PdfDocument.new()
    page = document.new_page(w * 72 / 200, h * 72 / 200)
    image = pdfium.PdfImage.new(document)
    image.set_bitmap(pdfium.PdfBitmap.from_pil(Image.fromarray(pixels, "RGB")))
    image.set_matrix(pdfium.PdfMatrix().scale(w * 72 / 200, h * 72 / 200))
    page.insert_obj(image)
    page.gen_content()
    result = prepare_page(_pdf_bytes(document))
    assert result.image.size == (w, h) and np.array_equal(np.asarray(result.image), pixels)


# --------------------------------------------------------------------------- dpi normalisation

from dataclasses import replace  # noqa: E402

from app import config  # noqa: E402
from app.cropping import CROP_MIN_DIM, bbox_pixels, encode_floor, normalize  # noqa: E402


def test_bbox_pixels_maps_the_1000_grid_onto_the_page():
    assert bbox_pixels((2000, 1000), [100, 200, 600, 700]) == (1000.0, 500.0)


def test_bbox_pixels_accepts_pixel_coordinates_too():
    assert bbox_pixels((2000, 1000), [0, 0, 1500, 900]) == (1500.0, 900.0)


def test_normalize_resamples_to_target_and_records_it(monkeypatch):
    monkeypatch.setattr(config, "TARGET_DPI", 200)
    frame = Frame(image=Image.new("RGB", (600, 300), "white"), label=None)
    out = normalize(frame, 100)
    assert out.image.size == (1200, 600)
    assert out.dpi == 100 and out.resampled == 2.0


def test_normalize_downsamples_too(monkeypatch):
    monkeypatch.setattr(config, "TARGET_DPI", 200)
    out = normalize(Frame(image=Image.new("RGB", (900, 600), "white")), 300)
    assert out.image.size == (600, 400)


def test_normalize_returns_the_same_object_when_nothing_changes(monkeypatch):
    monkeypatch.setattr(config, "TARGET_DPI", 200)
    frame = Frame(image=Image.new("RGB", (600, 300), "white"))
    assert normalize(frame, None) is frame
    close = normalize(frame, 204)
    assert close.image is frame.image and close.dpi == 204 and close.resampled == 1.0


def test_encode_floor_is_zero_only_with_a_known_dpi():
    frame = Frame(image=Image.new("RGB", (600, 300), "white"))
    assert encode_floor(frame) == CROP_MIN_DIM
    assert encode_floor(replace(frame, dpi=100)) == 0


def test_cut_turns_a_sideways_crop_upright(monkeypatch):
    monkeypatch.setattr(cropping, "detect_rotation", lambda image: 90)
    frame = cut(prepare_page(_png(600, 400)), None, None)
    assert frame.rotation == 90
    assert frame.image.size == (400, 600)


def test_cut_turns_the_other_way_too(monkeypatch):
    monkeypatch.setattr(cropping, "detect_rotation", lambda image: 270)
    frame = cut(prepare_page(_png(600, 400)), None, None)
    assert frame.rotation == 270
    assert frame.image.size == (400, 600)
