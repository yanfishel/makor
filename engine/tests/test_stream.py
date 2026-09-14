"""The progress channel: pipeline events for a live client (app.reading.Progress,
pipeline.run's `progress`, the NDJSON form of POST /extract). No model calls anywhere."""

import asyncio
import io
import json

from PIL import Image

from app import main, pipeline
from app.errors import ExtractionError
from app.pipeline import PipelineResult
from app.reading import Progress, _progress, emit_progress
from tests.conftest import post_image
from tests.test_main_engine import _doc
from tests.test_pipeline_classify import _blank_page, _fake_ollama
from tests.test_sefach_guard import _page_with_card_and_sefach


def test_emit_progress_is_a_noop_without_a_channel():
    emit_progress("regions", regions=[])  # nothing set: nothing raised, nothing sent


def test_progress_stamps_a_running_seq_and_a_millisecond_clock():
    seen: list[dict] = []
    progress = Progress(seen.append)
    progress.emit("page", width=1, height=2)
    progress.emit("regions", regions=[])
    assert [e["seq"] for e in seen] == [1, 2]
    assert all(isinstance(e["t"], int) and e["t"] >= 0 for e in seen)
    assert seen[0] == {"type": "page", "seq": 1, "t": seen[0]["t"], "width": 1, "height": 2}


def test_run_publishes_the_channel_to_the_pipeline_and_clears_it_after(monkeypatch):
    seen: list[dict] = []

    async def fake_run(raw):
        emit_progress("note", text="hello")
        return PipelineResult(extraction=None)

    monkeypatch.setattr(pipeline, "_run", fake_run)
    asyncio.run(pipeline.run(b"x", progress=Progress(seen.append)))
    assert [e["type"] for e in seen] == ["note"]
    assert _progress.get() is None


def test_run_without_a_channel_emits_nothing(monkeypatch):
    async def fake_run(raw):
        emit_progress("note", text="hello")
        return PipelineResult(extraction=None)

    monkeypatch.setattr(pipeline, "_run", fake_run)
    assert asyncio.run(pipeline.run(b"x")).extraction is None


def _events(monkeypatch, page: bytes, kinds: list[str]) -> list[dict]:
    _fake_ollama(monkeypatch, kinds)
    seen: list[dict] = []
    asyncio.run(pipeline.run(page, progress=Progress(seen.append)))
    return seen


def test_card_and_sefach_page_emits_the_stages_in_order(monkeypatch):
    seen = _events(monkeypatch, _page_with_card_and_sefach(), ["teudat_zehut"])
    types = [e["type"] for e in seen]
    assert types[:2] == ["page", "regions"]
    assert types.index("triage") > max(i for i, t in enumerate(types) if t == "classified")
    assert [e["seq"] for e in seen] == list(range(1, len(seen) + 1))

    page = seen[0]
    assert page["width"] == 850 and page["height"] == 1170 and "preview" not in page

    regions = seen[1]["regions"]
    assert [r["i"] for r in regions] == [0, 1]
    assert all(len(r["bbox_2d"]) == 4 and r["skipped"] is False for r in regions)
    assert regions[1]["label"] == "sefach"

    classified = {e["i"]: e for e in seen if e["type"] == "classified"}
    assert classified[0]["kind"] == "teudat_zehut" and classified[1]["kind"] == "sefach"

    triage = next(e for e in seen if e["type"] == "triage")
    assert [r["i"] for r in triage["read"]] == [0, 1] and triage["skipped"] == []
    assert all("dpi" in r for r in triage["read"])

    reads = [e for e in seen if e["type"] == "read"]
    assert [e["i"] for e in reads] == [0, 1]
    assert reads[0]["document_type"] == "teudat_zehut"
    assert reads[0]["fields"]["id_number"] == {"value": "123456782", "confidence": "high"}
    assert "document_type" not in reads[0]["fields"] and "mrz_lines" not in reads[0]["fields"]
    assert reads[1]["document_type"] == "teudat_zehut_sefach" and "sefach" in reads[1]
    readings = [e["i"] for e in seen if e["type"] == "reading"]
    assert readings == [0, 1]
    assert types.index("reading") < types.index("read")


def test_a_skipped_frame_is_in_triage_skipped_and_never_read(monkeypatch):
    seen = _events(monkeypatch, _page_with_card_and_sefach(), ["none"])
    triage = next(e for e in seen if e["type"] == "triage")
    assert triage["skipped"] == [0] and [r["i"] for r in triage["read"]] == [1]
    assert [e["i"] for e in seen if e["type"] == "reading"] == [1]
    assert any(e["type"] == "note" and "not read" in e["text"] for e in seen)


def test_the_whole_page_frame_has_index_none(monkeypatch):
    seen = _events(monkeypatch, _blank_page(), ["teudat_zehut"])
    assert next(e for e in seen if e["type"] == "regions")["regions"] == []
    assert next(e for e in seen if e["type"] == "classified")["i"] is None
    assert [e["i"] for e in seen if e["type"] == "reading"] == [None]
    assert next(e for e in seen if e["type"] == "read")["i"] is None


def _pdf_page() -> bytes:
    buffer = io.BytesIO()
    Image.open(io.BytesIO(_page_with_card_and_sefach())).save(buffer, format="PDF")
    return buffer.getvalue()


def test_a_pdf_upload_carries_a_jpeg_preview_of_the_page_the_engine_read(monkeypatch):
    seen = _events(monkeypatch, _pdf_page(), ["teudat_zehut"])
    page = seen[0]
    assert page["type"] == "page" and page["preview"].startswith("data:image/jpeg;base64,")
    assert page["width"] == 850 and page["height"] == 1170


def test_no_channel_means_no_preview_is_encoded(monkeypatch):
    _fake_ollama(monkeypatch, ["teudat_zehut"])

    def never(*args, **kwargs):
        raise AssertionError("encoded without a listener")

    monkeypatch.setattr(pipeline, "encode_jpeg", never)
    asyncio.run(pipeline.run(_pdf_page()))  # the local detector finds the regions: encode_jpeg is only the preview here


NDJSON = {"Accept": "application/x-ndjson"}


def _lines(resp) -> list[dict]:
    return [json.loads(line) for line in resp.text.splitlines()]


def test_ndjson_form_streams_the_events_then_done(client, monkeypatch):
    async def fake(raw, options=None, progress=None):
        progress.emit("regions", regions=[])
        return PipelineResult(extraction=_doc())

    monkeypatch.setattr(pipeline, "run", fake)
    resp = post_image(client, headers=NDJSON)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/x-ndjson")
    events = _lines(resp)
    assert [e["type"] for e in events] == ["regions", "done"]
    assert [e["seq"] for e in events] == [1, 2]
    assert events[-1]["result"]["document_type"] == "teudat_zehut"
    assert events[-1]["result"]["usage"] == []


def test_ndjson_done_equals_the_one_shot_body(client, monkeypatch):
    async def fake(raw, options=None, progress=None):
        return PipelineResult(extraction=_doc())

    monkeypatch.setattr(pipeline, "run", fake)
    one_shot = post_image(client).json()
    streamed = _lines(post_image(client, headers=NDJSON))[-1]["result"]
    assert streamed == one_shot


def test_ndjson_form_reports_a_pipeline_failure_as_an_error_line(client, monkeypatch):
    async def fake(raw, options=None, progress=None):
        raise ExtractionError("model refused")

    monkeypatch.setattr(pipeline, "run", fake)
    resp = post_image(client, headers=NDJSON)
    assert resp.status_code == 200
    events = _lines(resp)
    assert len(events) == 1 and events[0]["type"] == "error"
    assert events[0]["status"] == 502 and events[0]["detail"] == "model refused"
    assert events[0]["seq"] == 1


def test_ndjson_form_reports_a_failure_after_events_without_truncating_them(client, monkeypatch):
    async def fake(raw, options=None, progress=None):
        progress.emit("regions", regions=[])
        progress.emit("triage", read=[], skipped=[])
        raise ExtractionError("model refused")

    monkeypatch.setattr(pipeline, "run", fake)
    resp = post_image(client, headers=NDJSON)
    assert resp.status_code == 200
    events = _lines(resp)
    assert [e["type"] for e in events] == ["regions", "triage", "error"]
    assert [e["seq"] for e in events] == [1, 2, 3]
    assert events[-1]["status"] == 502 and events[-1]["detail"] == "model refused"


def test_ndjson_form_keeps_the_pre_stream_http_errors(client, monkeypatch):
    assert post_image(client, b"not an image", headers=NDJSON).status_code == 400
    monkeypatch.setattr(main.gate, "would_reject", lambda: True)
    resp = post_image(client, headers=NDJSON)
    assert resp.status_code == 503 and resp.headers["retry-after"]


def test_one_shot_form_is_untouched_by_the_accept_header_being_absent(client, monkeypatch):
    seen: list = []

    async def fake(raw, options=None):
        seen.append(options)
        return PipelineResult(extraction=_doc())

    monkeypatch.setattr(pipeline, "run", fake)  # the old two-argument signature still fits
    assert post_image(client).status_code == 200 and len(seen) == 1
