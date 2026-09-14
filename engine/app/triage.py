"""Stage 3a policy: given the classifier's kind for every frame on a page, which frames
are read. Pure — no image, no model, imports only doctypes (tier 1).

One document per page, plus its companions: an identity document on the page means
every identity-family frame is read (card + sefach, card + back — the merge rules in
assemble.py exist for them) and nothing else; with no identity document the first cheque
front and the first cheque back from the top are read; a page of "none" reads nothing and
is answered "not a document". Read indices keep frame order: results, frame_images and
the sefach guards in pipeline.py index into the read list, and a reorder once shifted a
guard onto the wrong document.

The geometry pre-gate (geometry_kinds, page_is_junk) runs before any model call on the
detector's boxes alone; its thresholds and their measurements live in config.py."""

from collections.abc import Sequence
from dataclasses import dataclass, field

from . import config
from .doctypes import CHEQUE_KINDS, IDENTITY_KINDS


@dataclass(frozen=True)
class Selection:
    read: list[int] = field(default_factory=list)
    skipped: list[int] = field(default_factory=list)


def select_frames(kinds: Sequence[str], tops: Sequence[int]) -> Selection:
    """`kinds[i]` is the classifier's answer for frame i, `tops[i]` its top edge (any
    monotonic unit; ties keep detector order). Empty `read` means "not a document"."""
    if len(kinds) != len(tops):
        raise ValueError("one top coordinate per kind")
    chosen: set[int] = set()
    if any(k in IDENTITY_KINDS for k in kinds):
        chosen = {i for i, k in enumerate(kinds) if k in IDENTITY_KINDS}
    elif any(k in CHEQUE_KINDS for k in kinds):
        for side in ("cheque_front", "cheque_back"):
            candidates = [i for i, k in enumerate(kinds) if k == side]
            if candidates:
                chosen.add(min(candidates, key=lambda i: (tops[i], i)))
    read = sorted(chosen)
    return Selection(read=read, skipped=[i for i in range(len(kinds)) if i not in chosen])


def cheque_back_inherits(kinds: Sequence[str | None]) -> bool:
    """Whether a detector-labelled cheque back may take kind "cheque_back" without a
    classifier call: yes when some frame on the page was classified "cheque_front". The
    detector labels a back only after cutting a front from the same sheet, so a confirmed
    front makes the back the other side of the same paper. Measured (2026-09-09): the 8B
    model classes a stamped back as "none" on 4/4 sheets at 512–768 px; opus says
    "cheque_back". Without a confirmed front the back is classified like any frame — a
    garbage page's invented back must not be read on the strength of a geometric label."""
    return "cheque_front" in kinds


# ------------------------------------------------------------------ geometry pre-gate

def _px(bbox: Sequence[int], page_size: tuple[int, int]) -> tuple[float, float]:
    width, height = page_size
    return (bbox[2] - bbox[0]) * width / 1000, (bbox[3] - bbox[1]) * height / 1000


def _area(b: Sequence[int]) -> int:
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def _inside(b: Sequence[int], o: Sequence[int]) -> float:
    """The share of b's area that lies inside o."""
    area = _area(b)
    if not area:
        return 0.0
    return max(0, min(b[2], o[2]) - max(b[0], o[0])) * max(0, min(b[3], o[3]) - max(b[1], o[1])) / area


def _contained(b: Sequence[int], others: Sequence[Sequence[int]]) -> bool:
    """b lies mostly inside some strictly larger box (equal boxes never contain each other)."""
    return any(_area(o) > _area(b) and _inside(b, o) > config.MAX_CONTAINMENT for o in others)


def geometry_kinds(bboxes: Sequence[Sequence[int]], page_size: tuple[int, int]) -> list[str | None]:
    """Per detector box (0-1000 units on a page of `page_size` pixels): "none" for a box
    no document can be — shorter than MIN_FRAME_EDGE on its long side, longer than
    MAX_FRAME_ASPECT to one, or mostly inside a larger box — and None for "ask the
    classifier". Thresholds and the corpus numbers behind them: config.py."""
    out: list[str | None] = []
    for b in bboxes:
        w, h = _px(b, page_size)
        if w <= 0 or h <= 0 or max(w, h) < config.MIN_FRAME_EDGE or max(w, h) / min(w, h) > config.MAX_FRAME_ASPECT:
            out.append("none")
        elif _contained(b, bboxes):
            out.append("none")
        else:
            out.append(None)
    return out


def page_is_junk(bboxes: Sequence[Sequence[int]], page_size: tuple[int, int]) -> bool:
    """Whether the page is rejected on geometry alone, before any model call: more than
    one impossible box, or nothing but impossible boxes. A single impossible box beside
    a real one is skipped without a call and the page goes on: a scanner leaves a sliver
    inside a passport page (one corpus page), a phone photo leaves a 5:1 strip above a
    passport spread (measured 2026-09-09 — the strict "lone junk outside a document
    rejects" rule threw that passport away). Several impossible boxes are what a page of
    text or a table looks like to the detector, and no document is looked for among them."""
    kinds = geometry_kinds(bboxes, page_size)
    junk = sum(1 for k in kinds if k == "none")
    return junk > 1 or (junk == 1 and junk == len(kinds))
