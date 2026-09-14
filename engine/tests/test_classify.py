"""reading/classify.py: one thumbnail call per Frame, the model faked at the call
wrapper. Checks what is sent (size, model, caps), not what the model would say."""

import asyncio
import base64
import io

from PIL import Image

from app import config, reading
from app.cropping import Frame
from app.reading import RunOptions, _options
from app.reading.classify import classify_frame
from app.schemas import FrameClass


def _frame(size=(1400, 900), label=None) -> Frame:
    return Frame(image=Image.new("RGB", size, (70, 110, 190)), bbox_2d=[0, 0, 1000, 1000], label=label)


def _decode(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.standard_b64decode(b64)))


def _run(coro, backend="ollama", classifier_model="tiny"):
    opts = RunOptions(backend=backend, model="m", api_key=None, effort="medium", classifier_model=classifier_model)
    token = _options.set(opts)
    try:
        return asyncio.run(coro)
    finally:
        _options.reset(token)


def test_ollama_call_sends_a_thumbnail_with_the_classifier_model_and_cap(monkeypatch):
    seen = {}

    async def fake(image_b64, system, user, schema, num_predict, retry_b64=None, degenerate=None, model=None):
        seen.update(image=image_b64, schema=schema, num_predict=num_predict, model=model, system=system)
        return FrameClass(kind="teudat_zehut", sure=True)

    monkeypatch.setattr(reading.classify, "_ollama_json", fake)
    answer = _run(classify_frame(_frame()))
    assert (answer.kind, answer.sure) == ("teudat_zehut", True)
    assert seen["schema"] is FrameClass
    assert seen["num_predict"] == config.CLASSIFY_MAX_TOKENS
    assert seen["model"] == "tiny"
    assert max(_decode(seen["image"]).size) == config.CLASSIFY_THUMB_DIM
    assert seen["system"]  # the classifier has its own system prompt


def test_a_small_crop_is_not_upscaled(monkeypatch):
    seen = {}

    async def fake(image_b64, *args, **kwargs):
        seen["image"] = image_b64
        return FrameClass(kind="cheque_front", sure=False)

    monkeypatch.setattr(reading.classify, "_ollama_json", fake)
    _run(classify_frame(_frame(size=(300, 120))))
    assert _decode(seen["image"]).size == (300, 120)


def _seen_anthropic(monkeypatch):
    seen = {}

    async def fake(image_b64, system, user, schema, model=None, max_tokens=4096, effort="unset"):
        seen.update(model=model, max_tokens=max_tokens, effort=effort, schema=schema)
        return FrameClass(kind="none", sure=True)

    monkeypatch.setattr(reading.classify, "_anthropic_parse", fake)
    return seen


def test_anthropic_call_uses_the_classifier_model_at_the_classifier_effort(monkeypatch):
    monkeypatch.setattr(config, "CLASSIFY_EFFORT", "low")
    seen = _seen_anthropic(monkeypatch)
    assert _run(classify_frame(_frame()), backend="anthropic", classifier_model="claude-opus-5").kind == "none"
    assert seen == {"model": "claude-opus-5", "max_tokens": config.CLASSIFY_MAX_TOKENS_ANTHROPIC, "effort": "low", "schema": FrameClass}


def test_an_empty_classifier_effort_sends_none(monkeypatch):
    monkeypatch.setattr(config, "CLASSIFY_EFFORT", "")
    seen = _seen_anthropic(monkeypatch)
    _run(classify_frame(_frame()), backend="anthropic", classifier_model="claude-opus-5")
    assert seen["effort"] is None


def test_a_detector_labelled_sefach_is_not_sent_to_the_model(monkeypatch):
    async def fake(*args, **kwargs):
        raise AssertionError("no model call expected")

    monkeypatch.setattr(reading.classify, "_ollama_json", fake)
    monkeypatch.setattr(reading.classify, "_anthropic_parse", fake)
    answer = _run(classify_frame(_frame(label="sefach")))
    assert (answer.kind, answer.sure) == ("sefach", True)


def test_other_detector_labels_do_not_short_circuit(monkeypatch):
    async def fake(*args, **kwargs):
        return FrameClass(kind="none", sure=True)

    monkeypatch.setattr(reading.classify, "_ollama_json", fake)
    assert _run(classify_frame(_frame(label="cheque_front"))).kind == "none"
