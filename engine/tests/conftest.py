"""Shared fixtures: an engine test client with the secret off, and a PNG to upload."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, cropping, main


@pytest.fixture(autouse=True)
def _no_real_orientation_model(monkeypatch):
    """cropping.cut asks orientation.detect_rotation on every crop. Left alone, that
    invokes the real rapidocr-onnxruntime engine on every pipeline.run()/cut() call in
    the suite (~50 of them, well over half the suite's runtime): every call abstains on
    these synthetic fixtures, so nothing is flaky, but the suite's behaviour then depends
    on an optional native dependency being installed and on how it responds to images it
    was never meant to see. Stub it to abstain by default; a test that genuinely
    exercises orientation (test_frames.py, test_orientation.py) overrides this with its
    own monkeypatch.setattr, which layers on top of this one without conflict."""
    monkeypatch.setattr(cropping, "detect_rotation", lambda image: None)


@pytest.fixture(autouse=True)
def _classifier_off_by_default(monkeypatch):
    """Stage 3a makes one extra model call per frame. The pipeline tests written before
    it fake the model by schema title and would KeyError on FrameClass; they test the
    reading stages, not triage, so the classifier is off unless a test turns it on
    (test_pipeline_classify.py does, with its own fake)."""
    monkeypatch.setattr(config, "CLASSIFY", False)


@pytest.fixture
def app_env(monkeypatch):
    monkeypatch.setattr(config, "ENV", "dev")
    monkeypatch.setattr(config, "ENGINE_SECRET", "")


@pytest.fixture
def client(app_env):
    with TestClient(main.app) as c:
        yield c


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "white").save(buf, format="PNG")
    return buf.getvalue()


def post_image(client: TestClient, data: bytes | None = None, headers: dict | None = None):
    return client.post("/extract", files={"file": ("x.png", io.BytesIO(data or png_bytes()), "image/png")},
                       headers=headers or {})
