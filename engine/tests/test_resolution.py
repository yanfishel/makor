"""resolution.py: dpi from a document's known physical size or from the scanned page.
Pure numbers; no image is opened."""

import math

import pytest

from app import config, resolution
from app.resolution import document_long_edge_px, estimate_dpi, low_resolution_warning, resample_factor


def test_untilted_box_is_the_document():
    assert document_long_edge_px(1024, 640, 0.0) == (1024.0, 640.0)


def test_tilted_box_is_corrected_back_to_the_rectangle():
    # an 856 x 540 card tilted by 25 degrees: axis-aligned box W = a cos + b sin, H = a sin + b cos
    a, b, t = 856.0, 540.0, math.radians(25.0)
    w, h = a * math.cos(t) + b * math.sin(t), a * math.sin(t) + b * math.cos(t)
    long, short = document_long_edge_px(w, h, 25.0)
    assert long == pytest.approx(a, rel=0.01)
    assert short == pytest.approx(b, rel=0.01)


def test_long_edge_is_the_larger_one_whatever_the_box_orientation():
    assert document_long_edge_px(640, 1024, 0.0) == (1024.0, 640.0)


def test_card_dpi_from_its_85_6_mm_long_edge_when_there_is_no_page():
    # a phone frame (16:9) holding a 1011 px card: 1011 / 85.6 mm = 300 dpi
    assert estimate_dpi("teudat_zehut", True, (1011.0, 638.0), (1920, 1080), False, True) == 300


def test_on_a_paper_page_the_page_beats_the_kind():
    # a sure card whose detector box is a wallet holding two cards (1485 px "long edge"):
    # the kind would say 440 dpi; the 3504 px A4 page says 300, which is the truth
    assert estimate_dpi("teudat_zehut", True, (1485.0, 1000.0), (2528, 3504), False, True) == 300


def test_unsure_card_on_an_a4_scan_falls_back_to_the_page():
    # page 1752 px long = A4 at 150 dpi; the kind is unsure so the card's size is not trusted
    assert estimate_dpi("teudat_zehut", False, (505.0, 320.0), (1264, 1752), False, True) == 150


def test_unsure_kind_on_a_non_paper_page_is_unknown():
    assert estimate_dpi("teudat_zehut", False, (900.0, 570.0), (1080, 1920), False, True) is None


def test_whole_page_frame_of_a_sure_card_uses_the_card():
    # a phone photo where the card fills the frame: 3000 px / 85.6 mm = 890 dpi
    assert estimate_dpi("teudat_zehut", True, (3000.0, 1900.0), (3000, 2250), True, True) == 890


def test_whole_page_frame_of_an_unsure_kind_is_unknown_even_when_paper_shaped():
    # a 4:3 photo is inside PAPER_ASPECT but it is not a sheet of paper
    assert estimate_dpi("sefach", False, (1600.0, 1200.0), (1600, 1200), True, True) is None


def test_passport_horizontal_edge_is_125_mm_for_a_page_and_a_vertical_spread():
    # on a 16:9 phone frame. landscape page: long edge horizontal = 125 mm; 1476 px -> 300 dpi
    assert estimate_dpi("foreign_passport", True, (1476.0, 1040.0), (3840, 2160), False, True) == 300
    # portrait vertical spread: SHORT edge horizontal = 125 mm; short 1476 px -> 300 dpi
    assert estimate_dpi("foreign_passport", True, (2079.0, 1476.0), (2160, 3840), False, False) == 300


def test_passport_horizontal_spread_is_250_mm():
    assert estimate_dpi("israeli_passport", True, (2953.0, 1040.0), (3508, 1728), True, True) == 300


def test_cheque_dpi_from_its_long_edge():
    # 608 px across 160 mm = 96.5 -> 97 dpi; the 608 x 566 sheet is not paper-shaped
    assert estimate_dpi("cheque_front", True, (608.0, 290.0), (608, 566), False, True) == 97


def test_old_sefach_strip_is_a4_wide_when_it_is_the_whole_frame():
    assert estimate_dpi("sefach", True, (2480.0, 1130.0), (2480, 1130), True, True) == 300


def test_current_sefach_sheet_comes_from_the_page():
    # 680 x 849 on an 850 x 1170 A4 scan: page long edge 1170 / 297 mm = 100 dpi
    assert estimate_dpi("sefach", True, (849.0, 680.0), (850, 1170), False, False) == 100


def test_none_kind_uses_the_page_when_it_is_paper():
    assert estimate_dpi("none", True, (400.0, 300.0), (1264, 1752), False, True) == 150
    assert estimate_dpi(None, False, (400.0, 300.0), (1264, 1752), False, True) == 150


def test_resample_factor_targets_config_and_tolerates_near_misses(monkeypatch):
    monkeypatch.setattr(config, "TARGET_DPI", 200)
    assert resample_factor(None) == 1.0
    assert resample_factor(100) == 2.0
    assert resample_factor(300) == pytest.approx(200 / 300)
    assert resample_factor(196) == 1.0  # within RESAMPLE_TOLERANCE of 1.0
    assert resample_factor(204) == 1.0


def test_warning_only_clearly_below_warn_dpi():
    assert low_resolution_warning(config.WARN_DPI) is None
    assert low_resolution_warning(141) is None  # a Letter page at 150 dpi taken for A4
    assert low_resolution_warning(134) is not None
    text = low_resolution_warning(97)
    assert text is not None
    assert "97 dpi" in text and str(config.WARN_DPI) in text


def test_warning_is_about_the_file_not_a_region():
    # Every crop comes out of one upload, so its resolution is a fact about the image the
    # user sent — naming a region invites "and what about the other one?".
    text = low_resolution_warning(80)
    assert "Region" not in text and "image" in text



def test_kind_tables_cover_every_classifier_kind_or_fall_through():
    from app.doctypes import FRAME_KINDS
    for kind in FRAME_KINDS:
        assert kind in resolution.CARD_KINDS | resolution.PASSPORT_KINDS | resolution.CHEQUE_KINDS | {"sefach", "none"}
