"""app/config.py: the prod start-up guard and the model default helper."""

import pytest

from app import config


def test_prod_requires_the_engine_secret(monkeypatch):
    monkeypatch.setattr(config, "ENV", "prod")
    monkeypatch.setattr(config, "ENGINE_SECRET", "")
    with pytest.raises(RuntimeError, match="MAKOR_ENGINE_SECRET"):
        config.check_startup()
    monkeypatch.setattr(config, "ENGINE_SECRET", "s3cret")
    config.check_startup()  # no exception


def test_dev_starts_without_a_secret(monkeypatch):
    monkeypatch.setattr(config, "ENV", "dev")
    monkeypatch.setattr(config, "ENGINE_SECRET", "")
    config.check_startup()


def test_gate_bounds_are_checked(monkeypatch):
    monkeypatch.setattr(config, "ENV", "dev")
    monkeypatch.setattr(config, "MAX_CONCURRENCY", 0)
    with pytest.raises(RuntimeError, match="MAX_CONCURRENCY"):
        config.check_startup()


def test_default_model_per_backend(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "ollama")
    monkeypatch.setattr(config, "MODEL", "qwen3-vl:30b-instruct")
    assert config.default_model("ollama") == "qwen3-vl:30b-instruct"
    assert config.default_model("anthropic") == "claude-opus-5"


def test_classifier_model_defaults_to_the_backend_model(monkeypatch):
    monkeypatch.setattr(config, "CLASSIFIER_MODEL", None)
    assert config.default_classifier_model("ollama", "qwen3-vl:8b-instruct") == "qwen3-vl:8b-instruct"
    assert config.default_classifier_model("anthropic", "claude-opus-5") == "claude-opus-5"


def test_classifier_model_env_override_applies_to_the_env_backend_only(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "anthropic")
    monkeypatch.setattr(config, "CLASSIFIER_MODEL", "claude-haiku-4-5")
    assert config.default_classifier_model("anthropic", "claude-opus-5") == "claude-haiku-4-5"
    # A request that switched backend by header keeps that backend's own model: an
    # Anthropic model name means nothing to Ollama.
    assert config.default_classifier_model("ollama", "qwen3-vl:8b-instruct") == "qwen3-vl:8b-instruct"


def test_classify_constants_are_sane():
    assert config.CLASSIFY_THUMB_DIM < config.MAX_IMAGE_DIMENSION
    assert 0 < config.CLASSIFY_MAX_TOKENS < config.CLASSIFY_MAX_TOKENS_ANTHROPIC


@pytest.mark.parametrize("model, expected", [
    ("claude-opus-5", True), ("claude-opus-4-6", True), ("claude-sonnet-5", True), ("claude-sonnet-4-6", True),
    ("claude-fable-5-1", True),
    ("claude-sonnet-4-5", False), ("claude-haiku-4-5", False), ("claude-haiku-4-5-20251001", False), ("qwen3-vl:8b-instruct", False),
])
def test_supports_effort_names_the_models_that_accept_output_config_effort(model, expected):
    assert config.supports_effort(model) is expected


def test_local_models_is_an_ordered_allow_list_with_the_default_first():
    ids = [m["id"] for m in config.LOCAL_MODELS]
    assert ids[0] == "qwen3-vl:8b-instruct"
    assert "qwen3-vl:30b-a3b-instruct" in ids
    assert "qwen3-vl:8b" not in ids  # reasoning mode, never offered
    for m in config.LOCAL_MODELS:
        assert set(m) == {"id", "label", "note"} and all(m.values())


def test_check_startup_rejects_a_local_model_entry_missing_a_key(monkeypatch):
    """LOCAL_MODELS feeds ModelInfo(**entry) on the GET /models path. A typo in that
    constant should fail the boot, not the first user request that reaches the endpoint."""
    monkeypatch.setattr(config, "LOCAL_MODELS", ({"id": "qwen3-vl:8b-instruct", "label": "Qwen3-VL 8B"},))
    with pytest.raises(RuntimeError, match="LOCAL_MODELS"):
        config.check_startup()


def test_check_startup_accepts_the_shipped_local_models():
    config.check_startup()  # the real constant must satisfy its own guard


def test_a_blank_variable_reads_as_unset(monkeypatch):
    # .env.example leaves most keys empty ("empty = the default"), and load_dotenv exports them
    # as "" — a blank MAKOR_BACKEND once reached the pipeline as backend ''.
    monkeypatch.setenv("MAKOR_TEST_SETTING", "  ")
    assert config.setting("MAKOR_TEST_SETTING", "ollama") == "ollama"
    monkeypatch.delenv("MAKOR_TEST_SETTING")
    assert config.setting("MAKOR_TEST_SETTING", "ollama") == "ollama"
    monkeypatch.setenv("MAKOR_TEST_SETTING", " anthropic ")
    assert config.setting("MAKOR_TEST_SETTING", "ollama") == "anthropic"
