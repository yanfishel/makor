"""Unit tests for app/regions.py — classical (OpenCV) document detection, no model calls.

Every image is synthetic: a grey scanner background with painted rectangles that
imitate the documents (a saturated blue card, a pale blue sefach sheet, a grey-scale
cheque made of ruled lines). No real sample enters the tests.
"""

from PIL import Image, ImageDraw

from app.regions import LocalRegion, detect_regions_local

BG = (205, 205, 205)  # scanner lid grey


def _page(size=(850, 1170), mode="RGB", bg=BG) -> Image.Image:
    return Image.new(mode, size, bg)


def _close(a: list[int], b: list[int], tol: int = 25) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b, strict=True))


def _labels(regions: list[LocalRegion]) -> list[str | None]:
    return [r.label for r in regions]


def _sefach(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int]) -> None:
    """The sheet: white paper under a grid of pale blue guilloche lines."""
    x1, y1, x2, y2 = box
    draw.rectangle(box, fill=(252, 252, 252))
    for y in range(y1, y2, 12):
        draw.line((x1, y, x2, y), fill=(150, 180, 220), width=1)
    for x in range(x1, x2, 12):
        draw.line((x, y1, x, y2), fill=(150, 180, 220), width=1)


def test_blank_page_returns_no_regions():
    assert detect_regions_local(_page()) == []


def test_colour_scan_finds_card_and_sefach():
    page = _page()
    draw = ImageDraw.Draw(page)
    # a saturated blue card, credit-card proportions, top of the page
    draw.rectangle((260, 0, 596, 206), fill=(70, 110, 190))
    # a large sefach sheet below it
    _sefach(draw, (135, 230, 770, 1030))

    regions = detect_regions_local(page)

    assert len(regions) == 2
    assert _labels(regions) == [None, "sefach"]  # top to bottom
    assert _close(regions[0].bbox_2d, [306, 0, 701, 176])
    assert _close(regions[1].bbox_2d, [159, 197, 906, 880])


def test_nested_boxes_inside_a_document_are_dropped():
    page = _page()
    draw = ImageDraw.Draw(page)
    # a guilloche border reads as a ring in the saturation mask...
    draw.rectangle((135, 230, 770, 1030), outline=(150, 180, 220), width=30)
    # ...with a separate blob inside it (a printed block)
    draw.rectangle((500, 400, 700, 600), fill=(150, 180, 220))

    regions = detect_regions_local(page)

    assert len(regions) == 1
    assert _close(regions[0].bbox_2d, [159, 197, 906, 880])


def _ruled_cheque(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int]) -> None:
    """Grey-scale cheque: a light body with ruled lines and a MICR line at the bottom."""
    x1, y1, x2, y2 = box
    draw.rectangle(box, fill=245)
    for y in range(y1 + 30, y2 - 40, 20):
        draw.line((x1 + 30, y, x2 - 30, y), fill=20, width=2)
    for x in range(x1 + 30, x2 - 30, 12):  # MICR digits
        draw.rectangle((x, y2 - 25, x + 8, y2 - 12), fill=0)


def test_grayscale_cheque_with_back_below():
    page = _page(size=(608, 566), mode="L", bg=235)
    draw = ImageDraw.Draw(page)
    _ruled_cheque(draw, (0, 0, 607, 280))
    # the guarantee stamp on the back, rotated, in the lower-left corner
    draw.rectangle((60, 320, 150, 540), outline=0, width=3)
    draw.line((80, 340, 130, 520), fill=0, width=2)

    regions = detect_regions_local(page)

    assert _labels(regions) == ["cheque_front", "cheque_back"]
    front, back = regions[0].bbox_2d, regions[1].bbox_2d
    assert 440 <= front[3] <= 500  # the front ends at its MICR line, not at the stamp
    assert front[2] - front[0] >= 850  # ...and spans the width
    assert back[1] == front[3] and back[3] == 1000  # the back is the rest of the page


def test_grayscale_cheque_front_only():
    page = _page(size=(632, 272), mode="L", bg=235)
    _ruled_cheque(ImageDraw.Draw(page), (0, 0, 631, 271))

    regions = detect_regions_local(page)

    assert _labels(regions) == ["cheque_front"]
    assert regions[0].bbox_2d[3] >= 940  # runs down to the MICR line at the bottom


def test_grayscale_front_with_blank_area_below_has_no_back():
    page = _page(size=(608, 566), mode="L", bg=235)
    _ruled_cheque(ImageDraw.Draw(page), (0, 0, 607, 280))

    regions = detect_regions_local(page)

    assert _labels(regions) == ["cheque_front"]


def test_whole_image_card_photo_is_one_unlabelled_region():
    # a phone photo of a card: the card fills the frame, portrait orientation
    page = _page(size=(1080, 1920))
    ImageDraw.Draw(page).rectangle((0, 0, 1079, 1919), fill=(90, 130, 200))

    regions = detect_regions_local(page)

    assert _labels(regions) == [None]
    assert _close(regions[0].bbox_2d, [0, 0, 1000, 1000])


def test_dense_portrait_page_is_not_a_sefach():
    # a passport page photocopied onto A4: sefach-sized and tinted, but full of print
    page = _page()
    draw = ImageDraw.Draw(page)
    _sefach(draw, (135, 230, 770, 1030))
    for y in range(260, 1000, 14):  # dense text lines
        draw.line((170, y, 730, y), fill=(40, 40, 40), width=6)

    regions = detect_regions_local(page)

    assert _labels(regions) == [None]


def test_colour_cheque_scan_splits_front_and_back():
    # a colour scan: tinted cheque paper on top, its back with a stamp below
    page = _page(size=(608, 566), bg=(235, 235, 235))
    draw = ImageDraw.Draw(page)
    draw.rectangle((0, 0, 607, 280), fill=(225, 235, 215))
    for y in range(30, 240, 20):
        draw.line((30, y, 577, y), fill=(20, 20, 20), width=2)
    draw.rectangle((60, 320, 150, 540), outline=(0, 0, 0), width=3)

    regions = detect_regions_local(page)

    assert _labels(regions) == ["cheque_front", "cheque_back"]
    assert 400 <= regions[0].bbox_2d[3] <= 500


def test_grayscale_card_photocopy_is_one_unlabelled_region():
    # a grey-scale photocopy of a card in the middle of an A4 page
    page = _page(size=(1264, 1752), mode="L", bg=240)
    draw = ImageDraw.Draw(page)
    draw.rectangle((130, 430, 760, 830), outline=0, width=4)
    for y in range(470, 800, 22):
        draw.line((400, y, 730, y), fill=30, width=5)

    regions = detect_regions_local(page)

    assert _labels(regions) == [None]
    assert _close(regions[0].bbox_2d, [103, 245, 601, 474], tol=30)


def test_pale_card_on_a_coloured_textured_background_is_found():
    # a phone photo: a pale card lying on a beige tablecloth (the background is the
    # saturated part of the image, the document is not)
    import random

    page = Image.new("RGB", (540, 960))
    rng = random.Random(1)
    px = page.load()
    for y in range(960):
        for x in range(540):
            n = rng.randint(-25, 25)
            px[x, y] = (190 + n, 165 + n, 125 + n)
    ImageDraw.Draw(page).rectangle((30, 240, 510, 540), fill=(236, 236, 232))

    regions = detect_regions_local(page)

    assert _labels(regions) == [None]
    assert _close(regions[0].bbox_2d, [56, 250, 944, 563], tol=20)


def test_a_pale_blob_reaching_the_frame_edge_is_the_desk_not_a_document():
    # a phone photo of a tinted passport spread on a light desk whose slight tint puts it
    # into the saturation mask (measured 2026-09-10: desk S 26, threshold 20), with an
    # un-tinted patch of desk running out to the frame edge. The mask covers most of the
    # frame, but the un-saturated blob is not a card lying ON the background — a
    # background surrounds its document — and taking it cut the passport's right column off.
    import random

    page = Image.new("RGB", (540, 960))
    rng = random.Random(3)
    px = page.load()
    for y in range(960):
        for x in range(540):
            n = rng.randint(-3, 3)
            px[x, y] = (200 + n, 190 + n, 175 + n)  # the desk, S ~32
    draw = ImageDraw.Draw(page)
    draw.rectangle((0, 0, 100, 959), fill=(206, 206, 206))  # un-tinted desk out to the left edge
    draw.rectangle((150, 200, 500, 800), fill=(225, 205, 180), outline=(70, 70, 130), width=3)  # the passport, S ~51, printed frame
    draw.rectangle((180, 500, 300, 700), fill=(110, 100, 95))  # its photo

    regions = detect_regions_local(page)

    boxes = [r.bbox_2d for r in regions]
    assert any(_close(b, [278, 208, 926, 834], tol=25) for b in boxes), boxes


def _wallet(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], pockets: list[tuple[int, int, int, int]]) -> None:
    """A dark blue plastic wallet with white paper documents in its pockets."""
    draw.rectangle(box, fill=(40, 60, 120))
    for pocket in pockets:
        draw.rectangle(pocket, fill=(240, 240, 236))


def test_two_documents_in_one_wallet_are_split_into_two_regions():
    page = _page(size=(1264, 1752))
    _wallet(ImageDraw.Draw(page), (260, 590, 930, 1580), [(300, 620, 890, 1030), (290, 1120, 900, 1550)])

    regions = detect_regions_local(page)

    assert _labels(regions) == [None, None]
    assert _close(regions[0].bbox_2d, [237, 354, 704, 588], tol=15)
    assert _close(regions[1].bbox_2d, [229, 639, 712, 885], tol=15)


def test_a_wallet_with_one_document_keeps_its_outer_box():
    page = _page(size=(1264, 1752))
    _wallet(ImageDraw.Draw(page), (260, 590, 930, 1580), [(300, 620, 890, 1550)])

    regions = detect_regions_local(page)

    assert len(regions) == 1
    assert _close(regions[0].bbox_2d, [206, 337, 736, 902], tol=15)


def test_a_dominant_island_does_not_split_the_box():
    # a passport spread: one bright page area covering most of the box plus a bright strip
    page = _page(size=(1264, 1752))
    _wallet(ImageDraw.Draw(page), (260, 590, 930, 1580), [(280, 610, 910, 1450), (280, 1480, 910, 1560)])

    regions = detect_regions_local(page)

    assert len(regions) == 1
    assert _close(regions[0].bbox_2d, [206, 337, 736, 902], tol=15)


# --------------------------------------------------------------------------- deskew()
# A phone photo of a card is rarely square to the frame; a 14° tilt made the 8B model's
# transcription loop until the token cap 2/2, and the straightened crop read fine 2/2.

from app.cropping import deskew, tilt_angle  # noqa: E402


def _tilted_card(angle: float) -> Image.Image:
    card = Image.new("RGB", (600, 380), (70, 110, 190))
    ImageDraw.Draw(card).rectangle((40, 60, 200, 260), fill=(240, 240, 236))  # the photo
    rotated = card.rotate(angle, expand=True, fillcolor=(205, 205, 205))
    page = Image.new("RGB", (900, 700), (205, 205, 205))
    page.paste(rotated, ((900 - rotated.width) // 2, (700 - rotated.height) // 2))
    return page


def test_tilt_angle_measures_the_documents_rotation():
    assert abs(tilt_angle(_tilted_card(12.0)) - 12.0) < 1.5
    assert abs(tilt_angle(_tilted_card(-9.0)) + 9.0) < 1.5
    assert abs(tilt_angle(_tilted_card(0.0))) < 1.0


def test_deskew_straightens_a_tilted_document():
    straight = deskew(_tilted_card(14.0))
    assert abs(tilt_angle(straight)) < 1.5


def test_deskew_leaves_a_square_document_alone():
    page = _tilted_card(0.0)
    assert deskew(page) is page


def test_deskew_leaves_a_slight_tilt_alone():
    # a 6° photocopy read fine untouched and lost fields once rotated: not worth the blur
    page = _tilted_card(6.0)
    assert deskew(page) is page


def test_deskew_ignores_a_blank_image():
    blank = Image.new("RGB", (300, 200), (205, 205, 205))
    assert deskew(blank) is blank


# --------------------------------------------------------------------------- narrow cheque scans
# A cheque scan cropped tight at the sides has a front aspect of ~1.6 (a cheque is ~2.3)
# and stays unlabelled on purpose: labelled by its dense ruling, the front crop looped
# until the token cap at every scale (6/6) while the uncropped page read fine.


def test_a_narrow_cheque_scan_is_left_unlabelled():
    page = _page(size=(480, 583), mode="L", bg=235)
    draw = ImageDraw.Draw(page)
    _ruled_cheque(draw, (0, 0, 479, 295))  # aspect 1.63
    draw.rectangle((60, 340, 150, 560), outline=0, width=3)

    regions = detect_regions_local(page)

    assert "cheque_front" not in _labels(regions)


def test_a_card_photocopy_with_only_its_border_is_not_a_cheque():
    # aspect 1.6 like the narrow scan, but just two full-width rules (the border), no ruling
    page = _page(size=(640, 400), mode="L", bg=235)
    draw = ImageDraw.Draw(page)
    draw.rectangle((10, 10, 629, 389), outline=0, width=4)
    for y in range(60, 340, 40):
        draw.line((330, y, 600, y), fill=30, width=5)  # short text lines, under half the width

    regions = detect_regions_local(page)

    assert _labels(regions) == [None]


def test_a_scanners_black_border_below_the_front_is_not_a_back():
    # the strip under the front is blank paper framed by the scanner's dark margins
    page = _page(size=(608, 566), mode="L", bg=235)
    draw = ImageDraw.Draw(page)
    _ruled_cheque(draw, (0, 0, 607, 280))
    draw.rectangle((0, 281, 8, 565), fill=0)  # the scanner's dark side margins
    draw.rectangle((599, 281, 607, 565), fill=0)

    regions = detect_regions_local(page)

    assert _labels(regions) == ["cheque_front"]


def test_pale_wide_strip_on_a_page_is_a_sefach_not_a_cheque():
    # Measured 2026-09-10: the old two-column sefach is a 210 x 96 mm
    # strip (aspect 2.2) — a cheque's shape, a sheet's paper (mean grey 244 against
    # 134-174 for every cheque in the corpus). Labelled cheque_front it went down the
    # cheque path, the classifier agreed, and the sheet was dropped as a cheque.
    page = _page()
    draw = ImageDraw.Draw(page)
    _sefach(draw, (40, 30, 810, 380))  # 770 x 350: aspect 2.2, 27 % of the page
    draw.rectangle((260, 500, 596, 706), fill=(70, 110, 190))  # the card below it

    regions = detect_regions_local(page)

    assert _labels(regions) == ["sefach", None]


def test_the_rest_of_the_page_under_a_cheque_front_is_a_back_only_when_cheque_shaped():
    # A cheque back is the front's shape (corpus backs: aspect 2.16-2.24). A tall rest of
    # the page holding ink is some other document: unlabelled, so the classifier sees it.
    page = _page(size=(608, 900), mode="L", bg=235)
    draw = ImageDraw.Draw(page)
    _ruled_cheque(draw, (0, 0, 607, 280))
    draw.rectangle((180, 340, 420, 860), outline=0, width=3)  # a card-like box below, well under half the width
    for y in range(380, 840, 40):
        draw.line((200, y, 400, y), fill=0, width=2)

    regions = detect_regions_local(page)

    assert _labels(regions) == ["cheque_front", None]
    assert regions[1].bbox_2d[1] >= 300


def test_islands_covering_less_than_most_of_the_blob_do_not_split_it():
    # Measured 2026-09-10: a passport spread with a white sticky note on one
    # page and a pale patch on the data page — two "islands" covering 0.43 of the blob. Split,
    # the data-page box lost the photo and the MRZ. Documents in a wallet fill it (0.71).
    page = _page(size=(1264, 1752))
    _wallet(ImageDraw.Draw(page), (260, 590, 930, 1580), [(300, 620, 890, 760), (300, 900, 890, 1230)])  # 0.12 + 0.29 of the blob

    regions = detect_regions_local(page)

    assert len(regions) == 1
    assert _close(regions[0].bbox_2d, [206, 337, 736, 902], tol=15)
