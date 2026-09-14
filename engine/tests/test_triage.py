"""triage.select_frames: which frames are read, from the classifier's kinds alone.
Pure policy — no image, no model."""

import typing

import pytest

from app import doctypes
from app.schemas import FrameClass
from app.triage import Selection, cheque_back_inherits, select_frames


def test_vocabularies_agree():
    literal = typing.get_args(FrameClass.model_fields["kind"].annotation)
    assert set(literal) == set(doctypes.FRAME_KINDS)
    assert set(doctypes.FRAME_KINDS) == doctypes.IDENTITY_KINDS | doctypes.CHEQUE_KINDS | {"none"}
    assert doctypes.UNSUPPORTED_KINDS <= doctypes.IDENTITY_KINDS
    assert set(doctypes.KIND_TO_LABEL) == set(doctypes.FRAME_KINDS) - {"none"}
    # "sefach" is dispatched by name in read_frame (expect_sefach), every other label through LABEL_TO_TYPE
    assert all(label is None or label == "sefach" or label in doctypes.LABEL_TO_TYPE for label in doctypes.KIND_TO_LABEL.values())
    assert all(doctypes.KIND_TO_LABEL[k] is None for k in doctypes.UNSUPPORTED_KINDS)
    assert doctypes.UNSUPPORTED_KINDS == {"senior_citizen_card", "weapon_license"}


def test_identity_present_reads_every_identity_frame_and_skips_the_rest():
    kinds = ["cheque_front", "teudat_zehut", "none", "sefach"]
    assert select_frames(kinds, [0, 100, 200, 300]) == Selection(read=[1, 3], skipped=[0, 2])


def test_unsupported_types_count_as_identity():
    assert select_frames(["senior_citizen_card", "cheque_front"], [0, 10]) == Selection(read=[0], skipped=[1])


def test_cheques_only_reads_the_first_front_and_first_back_by_top():
    # detector order is not top-to-bottom here on purpose
    kinds = ["cheque_front", "cheque_back", "cheque_front", "cheque_back", "none"]
    tops = [500, 900, 100, 700, 0]
    assert select_frames(kinds, tops) == Selection(read=[2, 3], skipped=[0, 1, 4])


def test_a_tie_on_top_keeps_detector_order():
    assert select_frames(["cheque_front", "cheque_front"], [100, 100]) == Selection(read=[0], skipped=[1])


def test_a_back_alone_is_read():
    assert select_frames(["cheque_back"], [0]) == Selection(read=[0], skipped=[])


def test_all_none_reads_nothing():
    assert select_frames(["none", "none"], [0, 1]) == Selection(read=[], skipped=[0, 1])


def test_empty_input():
    assert select_frames([], []) == Selection(read=[], skipped=[])


def test_read_indices_come_back_in_frame_order():
    kinds = ["sefach", "cheque_front", "teudat_zehut"]
    assert select_frames(kinds, [900, 0, 100]).read == [0, 2]


def test_lengths_must_match():
    with pytest.raises(ValueError):
        select_frames(["none"], [])


def test_a_detector_back_inherits_from_a_confirmed_front():
    assert cheque_back_inherits(["cheque_front", None]) is True
    assert cheque_back_inherits([None, "cheque_front", "none"]) is True


def test_a_detector_back_is_classified_when_no_front_was_confirmed():
    assert cheque_back_inherits(["none", None]) is False
    assert cheque_back_inherits(["teudat_zehut", None]) is False
    assert cheque_back_inherits([]) is False


# --------------------------------------------------------------- geometry_kinds()
from app.triage import geometry_kinds  # noqa: E402

PAGE = (1000, 1000)  # 1 px per 0-1000 unit, so bbox sizes read as pixels


def test_a_normal_region_is_left_to_the_classifier():
    assert geometry_kinds([[100, 100, 500, 350]], PAGE) == [None]


def test_a_region_below_the_edge_floor_is_none_without_a_call():
    assert geometry_kinds([[100, 100, 300, 340]], PAGE) == ["none"]  # 200 x 240 px


def test_the_edge_floor_scales_with_the_page_size():
    # the same 0-1000 box on a 2000-px page is 400 x 480 px: fine
    assert geometry_kinds([[100, 100, 300, 340]], (2000, 2000)) == [None]


def test_an_extreme_aspect_is_none():
    assert geometry_kinds([[0, 0, 1000, 150]], PAGE) == ["none"]  # 6.7:1 strip


def test_the_aspect_boundary():
    assert geometry_kinds([[0, 0, 300, 1000]], PAGE) == [None]  # 3.33
    assert geometry_kinds([[0, 0, 280, 1000]], PAGE) == ["none"]  # 3.57


def test_a_region_mostly_inside_a_larger_one_is_none_but_the_larger_stays():
    big, inner = [50, 50, 950, 950], [100, 100, 500, 500]
    assert geometry_kinds([big, inner], PAGE) == [None, "none"]
    assert geometry_kinds([inner, big], PAGE) == ["none", None]


def test_a_slight_overlap_between_two_documents_is_kept():
    a, b = [0, 0, 520, 400], [480, 0, 1000, 400]  # 8% of each inside the other
    assert geometry_kinds([a, b], PAGE) == [None, None]


def test_equal_boxes_do_not_kill_each_other():
    box = [100, 100, 600, 500]
    assert geometry_kinds([box, list(box)], PAGE) == [None, None]


def test_degenerate_box_is_none():
    assert geometry_kinds([[100, 100, 100, 400]], PAGE) == ["none"]


def test_geometry_empty_input():
    assert geometry_kinds([], PAGE) == []


# --------------------------------------------------------------- page_is_junk()
from app.triage import page_is_junk  # noqa: E402


def test_no_junk_no_rejection():
    assert page_is_junk([[100, 100, 500, 350], [550, 100, 950, 350]], PAGE) is False


def test_one_contained_sliver_does_not_reject():
    assert page_is_junk([[50, 50, 950, 950], [100, 100, 700, 180]], PAGE) is False  # 600x80 strip inside


def test_one_lone_junk_box_beside_a_document_does_not_reject():
    # a phone photo of a passport gave a 5:1 strip above the spread — the strip is skipped,
    # the spread goes on (measured 2026-09-09)
    assert page_is_junk([[100, 100, 900, 700], [0, 900, 1000, 950]], PAGE) is False


def test_two_junk_boxes_reject_even_when_contained():
    assert page_is_junk([[50, 50, 950, 950], [100, 100, 700, 180], [100, 300, 700, 380]], PAGE) is True


def test_only_junk_rejects():
    assert page_is_junk([[0, 0, 1000, 100]], PAGE) is True
