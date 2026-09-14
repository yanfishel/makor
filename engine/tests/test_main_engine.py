"""main.py as a stateless engine: shared secret, override headers, usage in the body."""

import anthropic
import httpx

from app import config, pipeline
from app.pipeline import PipelineResult
from app.reading import CallUsage, RunOptions, backend_ollama
from app.schemas import DocumentExtraction, ExtractedField, RegionResult

from .conftest import post_image
from .test_cheque import cheque as make_cheque


def _doc() -> DocumentExtraction:
    skip = ("document_type", "mrz_lines", "notes")
    fields = {name: ExtractedField(value=None, confidence="low")
              for name in DocumentExtraction.model_fields if name not in skip}
    return DocumentExtraction(document_type="teudat_zehut", mrz_lines=None, notes=None, **fields)


def _fake_run(seen: list, usage=None):
    async def fake(raw, options=None):
        seen.append(options)
        return PipelineResult(extraction=_doc(), usage=usage or [])
    return fake


def test_secret_required_when_configured(client, monkeypatch):
    monkeypatch.setattr(config, "ENGINE_SECRET", "s3cret")
    assert post_image(client).status_code == 401
    assert post_image(client, headers={"X-Engine-Secret": "wrong"}).status_code == 401
    monkeypatch.setattr(pipeline, "run", _fake_run([]))
    assert post_image(client, headers={"X-Engine-Secret": "s3cret"}).status_code == 200


def test_non_ascii_secret_is_401_not_500(client, monkeypatch):
    # Starlette decodes headers as latin-1; send the raw bytes to reproduce that,
    # since httpx's test client rejects a non-ASCII str header value outright.
    monkeypatch.setattr(config, "ENGINE_SECRET", "s3cret")
    assert post_image(client, headers={"X-Engine-Secret": "sécret".encode("latin-1")}).status_code == 401


def test_no_secret_configured_means_open(client, monkeypatch):
    monkeypatch.setattr(pipeline, "run", _fake_run([]))
    assert post_image(client).status_code == 200


def test_wrong_secret_is_401_even_without_a_multipart_body(client, monkeypatch):
    monkeypatch.setattr(config, "ENGINE_SECRET", "s3cret")
    # No multipart body at all: without the Depends() the request would be a 422 (missing `file`).
    res = client.post("/extract", content=b"not multipart", headers={"content-type": "text/plain", "x-engine-secret": "wrong"})
    assert res.status_code == 401


def test_headers_become_run_options(client, monkeypatch):
    seen: list = []
    monkeypatch.setattr(pipeline, "run", _fake_run(seen))
    monkeypatch.setattr(config, "BACKEND", "ollama")
    resp = post_image(client, headers={"X-Backend": "anthropic", "X-Model": "claude-sonnet-5", "X-Anthropic-Key": "sk-ant-user"})
    assert resp.status_code == 200
    assert seen == [RunOptions(backend="anthropic", model="claude-sonnet-5", api_key="sk-ant-user",
                               effort=config.ANTHROPIC_EFFORT, classifier_model="claude-sonnet-5")]
    assert resp.json()["model"] == "anthropic/claude-sonnet-5"


def test_no_headers_means_env_defaults(client, monkeypatch):
    seen: list = []
    monkeypatch.setattr(pipeline, "run", _fake_run(seen))
    post_image(client)
    assert seen == [RunOptions.from_config()]


def test_unknown_backend_is_400(client):
    assert post_image(client, headers={"X-Backend": "gemini"}).status_code == 400


def test_usage_is_returned_in_the_body(client, monkeypatch):
    usage = [CallUsage(backend="anthropic", model="claude-opus-5", schema="DocumentExtraction",
                        input_tokens=100, output_tokens=40, cache_read_tokens=10, cache_write_tokens=0)]
    monkeypatch.setattr(pipeline, "run", _fake_run([], usage))
    body = post_image(client).json()
    assert body["usage"] == [{"backend": "anthropic", "model": "claude-opus-5", "schema_name": "DocumentExtraction",
                              "input_tokens": 100, "output_tokens": 40, "cache_read_tokens": 10, "cache_write_tokens": 0}]


def test_rejected_key_is_502_with_anthropic_status(client, monkeypatch):
    async def fake(raw, options=None):
        raise anthropic.AuthenticationError(
            message="invalid x-api-key",
            response=httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")),
            body=None,
        )
    monkeypatch.setattr(pipeline, "run", fake)
    resp = post_image(client, headers={"X-Anthropic-Key": "sk-ant-bad"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == {"message": "Model API rejected the API key", "anthropic_status": 401}


def test_old_routes_are_gone(client):
    assert client.get("/").status_code == 404
    assert client.get("/v1/usage").status_code == 404
    assert client.post("/v1/extract").status_code == 404


# --- error mapping before extraction ever runs -----------------------------------


def test_unreadable_image_is_400_without_calling_extraction(client, monkeypatch):
    called: list = []
    monkeypatch.setattr(pipeline, "run", _fake_run(called))
    resp = post_image(client, data=b"not an image")
    assert resp.status_code == 400
    assert called == []


def test_upload_too_large_is_413_without_calling_extraction(client, monkeypatch):
    called: list = []
    monkeypatch.setattr(pipeline, "run", _fake_run(called))
    oversized = b"x" * (config.MAX_UPLOAD_BYTES + 1)
    resp = post_image(client, data=oversized)
    assert resp.status_code == 413
    assert called == []


# --- the cheque response branch --------------------------------------------------


def _fake_cheque_pipeline(monkeypatch, cheque, extraction_doc=None, warnings=()):
    async def fake(raw, options=None):
        return PipelineResult(extraction=extraction_doc, usage=[], cheque=cheque, warnings=list(warnings))
    monkeypatch.setattr(pipeline, "run", fake)


def test_cheque_response_shape_and_validation(client, monkeypatch):
    _fake_cheque_pipeline(monkeypatch, make_cheque(
        cheque_number="80001234", bank_code="11", branch_number="148", account_number="123456",
        drawer_id_number="123456782", amount="4500.00", amount_in_words='ארבעת אלפים וחמש מאות ש"ח',
        payee_only=True, micr_line="80001234 11 14841 0000123456", notes="faint stamp"))
    data = post_image(client).json()
    assert data["document_type"] == "cheque"
    assert data["fields"]["payee_only"] is True
    assert data["fields"]["amount"] == {"value": "4500.00", "confidence": "high"}
    assert "micr_line" not in data["fields"] and "notes" not in data["fields"]
    assert data["validation"]["overall"] == "verified" and data["validation"]["micr_parsed"] is True
    assert data["warnings"] == ["faint stamp"]
    assert data["sefach"] is None


def test_cheque_warnings(client, monkeypatch):
    _fake_cheque_pipeline(monkeypatch, make_cheque(
        cheque_number="80001235", bank_code="11", branch_number="148", account_number="123456",
        drawer_id_number="123456783", guarantor_id_number="123456783", amount="4600.00",
        amount_in_words='ארבעת אלפים וחמש מאות ש"ח', micr_line="80001234 11 14841 0000123456"))
    warnings = post_image(client).json()["warnings"]
    assert "MICR present but does not match printed details" in warnings
    assert "amount in words does not match the figure" in warnings
    assert "Israeli ID number failed its check-digit test" in warnings
    assert "guarantor ID failed its check-digit test" in warnings


def test_cheque_unparseable_words_warning(client, monkeypatch):
    _fake_cheque_pipeline(monkeypatch, make_cheque(amount="10.00", amount_in_words="בלה", micr_line=None))
    data = post_image(client).json()
    assert "amount in words not parseable" in data["warnings"]
    assert data["validation"]["overall"] == "unverified"


def test_cheque_response_carries_usage_and_model(client, monkeypatch):
    usage = [CallUsage(backend="ollama", model="qwen3-vl:8b-instruct", schema="ChequeExtraction",
                        input_tokens=200, output_tokens=80, cache_read_tokens=0, cache_write_tokens=0)]

    async def fake(raw, options=None):
        return PipelineResult(extraction=None, usage=usage, cheque=make_cheque(document_type="cheque_back"))
    monkeypatch.setattr(pipeline, "run", fake)
    monkeypatch.setattr(config, "BACKEND", "ollama")
    resp = post_image(client, headers={"X-Model": "qwen3-vl:8b-instruct"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["document_type"] == "cheque_back"
    assert body["model"] == "ollama/qwen3-vl:8b-instruct"
    assert body["usage"] == [{"backend": "ollama", "model": "qwen3-vl:8b-instruct", "schema_name": "ChequeExtraction",
                              "input_tokens": 200, "output_tokens": 80, "cache_read_tokens": 0, "cache_write_tokens": 0}]


# --- the not_a_document response branch and the phase-1 classifier label ---------


def _fake_run_result(result: PipelineResult):
    async def fake(raw, options=None):
        return result
    return fake


def _other_doc() -> DocumentExtraction:
    doc = _doc()
    doc.document_type = "other"
    return doc


def test_nothing_read_is_not_a_document_with_200(client, monkeypatch):
    skipped = [RegionResult(label="document", bbox_2d=[0, 0, 1000, 1000], document_type="skipped")]
    monkeypatch.setattr(pipeline, "run", _fake_run_result(PipelineResult(extraction=None, regions=skipped,
                                                                          warnings=[])))
    resp = post_image(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["document_type"] == "not_a_document"
    assert body["fields"] == {}
    assert body["validation"]["overall"] == "unverified"
    assert body["validation"]["mrz_present"] is False and body["validation"]["cross_checks"] == []
    assert body["warnings"] == ["No supported document was found on the page"]
    assert body["regions"] == [{"label": "document", "bbox_2d": [0, 0, 1000, 1000], "document_type": "skipped", "dpi": None}]
    assert body["sefach"] is None


def test_an_other_document_without_a_cheque_is_not_a_document_too(client, monkeypatch):
    # classifier off, every region read as "other": one contract for both modes
    monkeypatch.setattr(pipeline, "run", _fake_run_result(PipelineResult(extraction=_other_doc())))
    body = post_image(client).json()
    assert body["document_type"] == "not_a_document"
    assert body["fields"] == {}


def test_an_unsupported_kind_keeps_its_fields_under_the_classifier_label(client, monkeypatch):
    doc = _other_doc()
    doc.id_number = ExtractedField(value="123456782", confidence="high")
    monkeypatch.setattr(pipeline, "run", _fake_run_result(PipelineResult(extraction=doc, classified_type="senior_citizen_card")))
    body = post_image(client).json()
    assert body["document_type"] == "senior_citizen_card"
    assert body["fields"]["id_number"]["value"] == "123456782"
    assert "Field extraction for senior_citizen_card is not tuned; values are best effort" in body["warnings"]


def test_other_next_to_a_cheque_still_answers_the_cheque(client, monkeypatch):
    monkeypatch.setattr(pipeline, "run", _fake_run_result(PipelineResult(extraction=_other_doc(), cheque=make_cheque())))
    assert post_image(client).json()["document_type"] == "cheque"


def test_upload_limit_is_thirty_megabytes_and_the_message_says_so(client, monkeypatch):
    called: list = []
    monkeypatch.setattr(pipeline, "run", _fake_run(called))
    assert config.MAX_UPLOAD_BYTES == 30 * 1024 * 1024
    resp = post_image(client, data=b"x" * (config.MAX_UPLOAD_BYTES + 1))
    assert resp.status_code == 413 and "30 MB" in resp.json()["detail"]


def test_a_pdf_upload_is_accepted(client, monkeypatch):
    import io

    from PIL import Image

    called: list = []
    monkeypatch.setattr(pipeline, "run", _fake_run(called))
    buffer = io.BytesIO()
    Image.new("RGB", (300, 400), "white").save(buffer, format="PDF")
    resp = post_image(client, data=buffer.getvalue())
    assert resp.status_code == 200 and len(called) == 1


def test_a_broken_pdf_is_400(client, monkeypatch):
    called: list = []
    monkeypatch.setattr(pipeline, "run", _fake_run(called))
    resp = post_image(client, data=b"%PDF-1.4 garbage")
    assert resp.status_code == 400 and called == []


def _tags(names):
    async def fake():
        return names
    return fake


def test_models_lists_the_allow_list_with_installed_flags(client, monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "ollama")
    monkeypatch.setattr(config, "MODEL", "qwen3-vl:8b-instruct")
    monkeypatch.setattr(backend_ollama, "installed_models", _tags(["qwen3-vl:8b-instruct", "qwen3-vl:8b"]))
    body = client.get("/models").json()
    assert body["backend"] == "ollama" and body["default_local"] == "qwen3-vl:8b-instruct" and body["ollama_reachable"] is True
    by_id = {m["id"]: m for m in body["models"]}
    assert by_id["qwen3-vl:8b-instruct"]["installed"] is True
    assert by_id["qwen3-vl:30b-a3b-instruct"]["installed"] is False
    assert "qwen3-vl:8b" not in by_id
    assert set(by_id["qwen3-vl:8b-instruct"]) == {"id", "label", "note", "installed"}


def test_models_when_ollama_is_down(client, monkeypatch):
    monkeypatch.setattr(backend_ollama, "installed_models", _tags(None))
    body = client.get("/models").json()
    assert body["ollama_reachable"] is False and all(m["installed"] is False for m in body["models"])


def test_models_on_the_anthropic_backend_still_lists_local_models(client, monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "anthropic")
    monkeypatch.setattr(config, "MODEL", "claude-opus-5")
    monkeypatch.setattr(backend_ollama, "installed_models", _tags([]))
    body = client.get("/models").json()
    assert body["backend"] == "anthropic" and len(body["models"]) == 2
    # Both defaults travel whatever the engine runs: the web app names the model of the
    # backend the USER picked, which need not be the engine's own.
    assert body["default_local"] == "qwen3-vl:8b-instruct" and body["default_cloud"] == "claude-opus-5"


def test_models_requires_the_secret_when_configured(client, monkeypatch):
    monkeypatch.setattr(config, "ENGINE_SECRET", "s3cret")
    assert client.get("/models").status_code == 401
    monkeypatch.setattr(backend_ollama, "installed_models", _tags([]))
    assert client.get("/models", headers={"X-Engine-Secret": "s3cret"}).status_code == 200
