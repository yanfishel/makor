"""RunOptions: per-request backend/model/key/effort, carried through a ContextVar."""

import asyncio
from types import SimpleNamespace

import pytest

from app import config, pipeline, reading
from app.reading import RunOptions


def test_from_config_mirrors_the_env_defaults(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "ollama")
    monkeypatch.setattr(config, "MODEL", "qwen3-vl:8b-instruct")
    monkeypatch.setattr(config, "ANTHROPIC_EFFORT", "medium")
    monkeypatch.setattr(config, "CLASSIFIER_MODEL", None)
    opts = RunOptions.from_config()
    assert opts == RunOptions(backend="ollama", model="qwen3-vl:8b-instruct", api_key=None, effort="medium",
                              classifier_model="qwen3-vl:8b-instruct")


def test_resolve_keeps_the_env_model_for_the_env_backend(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "ollama")
    monkeypatch.setattr(config, "MODEL", "qwen3-vl:30b-instruct")
    assert RunOptions.resolve(None, None, None).model == "qwen3-vl:30b-instruct"
    assert RunOptions.resolve("ollama", None, None).model == "qwen3-vl:30b-instruct"


def test_resolve_uses_the_backend_default_when_switching_backend(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "ollama")
    monkeypatch.setattr(config, "MODEL", "qwen3-vl:30b-instruct")
    opts = RunOptions.resolve("anthropic", None, "sk-ant-user")
    assert opts.backend == "anthropic"
    assert opts.model == config.default_model("anthropic")
    assert opts.api_key == "sk-ant-user"


def test_resolve_explicit_model_wins(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "anthropic")
    assert RunOptions.resolve("anthropic", "claude-sonnet-5", None).model == "claude-sonnet-5"


def test_resolve_rejects_unknown_backend():
    with pytest.raises(pipeline.ConfigurationError):
        RunOptions.resolve("gemini", None, None)


def test_repr_never_exposes_the_api_key():
    opts = RunOptions(backend="anthropic", model="m", api_key="sk-ant-x", effort="")
    assert "sk-ant" not in repr(opts)


def test_run_publishes_options_to_the_pipeline(monkeypatch):
    seen: list[RunOptions] = []

    async def fake_run(raw):
        seen.append(reading.current_options())
        return pipeline.PipelineResult(extraction=None)

    monkeypatch.setattr(pipeline, "_run", fake_run)
    opts = RunOptions(backend="anthropic", model="claude-opus-5", api_key="sk-ant-x", effort="low")
    asyncio.run(pipeline.run(b"", opts))
    assert seen == [opts]
    # Outside run() the ContextVar falls back to the env defaults.
    assert reading.current_options() == RunOptions.from_config()


def test_usage_rows_carry_the_request_model(monkeypatch):
    collected: list = []
    token = reading._usage_collector.set(collected)
    opts_token = reading._options.set(RunOptions(backend="anthropic", model="claude-sonnet-5", api_key=None, effort=""))
    try:
        reading._log_usage("anthropic", pipeline.DocumentExtraction, input_tokens=10, output_tokens=5)
    finally:
        reading._options.reset(opts_token)
        reading._usage_collector.reset(token)
    assert collected[0].model == "claude-sonnet-5"


def test_get_client_with_a_user_key_is_a_fresh_client(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env")
    monkeypatch.setattr(reading.backend_anthropic, "_client", None)
    env_client = reading.backend_anthropic.get_client()
    assert reading.backend_anthropic.get_client() is env_client
    user_client = reading.backend_anthropic.get_client("sk-ant-user")
    assert user_client is not env_client
    assert user_client.api_key == "sk-ant-user"
    # Outside run() (_options is unset) a user-key client is never cached: keys must not linger.
    assert reading.backend_anthropic.get_client("sk-ant-user") is not user_client


def test_run_builds_one_user_client_and_closes_it(monkeypatch):
    built: list = []

    class FakeClient:
        def __init__(self, api_key=None):
            self.api_key = api_key
            self.closed = False
            built.append(self)
        async def close(self):
            self.closed = True

    monkeypatch.setattr(reading.backend_anthropic.anthropic, "AsyncAnthropic", FakeClient)
    seen: list = []

    async def fake_run(raw):
        seen.append(reading.backend_anthropic.get_client("sk-ant-user"))
        seen.append(reading.backend_anthropic.get_client("sk-ant-user"))
        return pipeline.PipelineResult(extraction=None)

    monkeypatch.setattr(pipeline, "_run", fake_run)
    opts = RunOptions(backend="anthropic", model="claude-opus-5", api_key="sk-ant-user", effort="")
    asyncio.run(pipeline.run(b"", opts))
    assert len(built) == 1 and seen[0] is seen[1] is built[0]
    assert built[0].closed is True


def test_run_without_a_user_key_builds_no_client(monkeypatch):
    built: list = []
    monkeypatch.setattr(reading.backend_anthropic.anthropic, "AsyncAnthropic", lambda **kw: built.append(kw))

    async def fake_run(raw):
        return pipeline.PipelineResult(extraction=None)

    monkeypatch.setattr(pipeline, "_run", fake_run)
    asyncio.run(pipeline.run(b"", RunOptions(backend="ollama", model="m", api_key=None, effort="")))
    assert built == []


def test_anthropic_parse_forwards_the_request_key_and_model(monkeypatch):
    """The request's api_key must reach get_client() and its model must reach the API
    call — if either stopped being forwarded, a user-supplied key would silently fall
    back to the engine's own key and bill the wrong account, with no test to catch it."""
    client_calls: list[str | None] = []
    parse_calls: list[dict] = []

    async def parse(**kwargs):
        parse_calls.append(kwargs)
        # parsed_output must not be None: an unparsed answer is a truncation (ExtractionError).
        return SimpleNamespace(stop_reason="end_turn", stop_details=None, usage=None, parsed_output=SimpleNamespace())

    def fake_get_client(api_key=None):
        client_calls.append(api_key)
        return SimpleNamespace(messages=SimpleNamespace(parse=parse))

    monkeypatch.setattr(reading.backend_anthropic, "get_client", fake_get_client)
    opts = RunOptions(backend="anthropic", model="claude-sonnet-5", api_key="sk-ant-user", effort="")
    opts_token = reading._options.set(opts)
    try:
        asyncio.run(reading.backend_anthropic._anthropic_parse("img", "sys", "user", pipeline.DocumentExtraction))
    finally:
        reading._options.reset(opts_token)
    assert client_calls == ["sk-ant-user"]
    assert parse_calls[0]["model"] == "claude-sonnet-5"


def test_ollama_json_sends_the_request_model_in_the_payload(monkeypatch):
    """The Ollama payload's "model" must carry the request's model, not the env default."""
    captured: dict = {}

    async def fake_ollama_call(payload, schema, model=None):
        captured.update(payload)
        return "ok"

    monkeypatch.setattr(reading.backend_ollama, "_ollama_call", fake_ollama_call)
    opts = RunOptions(backend="ollama", model="qwen3-vl:30b-instruct", api_key=None, effort="")
    opts_token = reading._options.set(opts)
    try:
        result = asyncio.run(reading.backend_ollama._ollama_json("img", None, "user", pipeline.DocumentExtraction, 100))
    finally:
        reading._options.reset(opts_token)
    assert result == "ok"
    assert captured["model"] == "qwen3-vl:30b-instruct"


def test_from_config_carries_the_classifier_model(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "anthropic")
    monkeypatch.setattr(config, "MODEL", "claude-opus-5")
    monkeypatch.setattr(config, "CLASSIFIER_MODEL", "claude-haiku-4-5")
    assert RunOptions.from_config().classifier_model == "claude-haiku-4-5"


def test_resolve_classifier_model_follows_the_resolved_backend(monkeypatch):
    monkeypatch.setattr(config, "BACKEND", "anthropic")
    monkeypatch.setattr(config, "MODEL", "claude-opus-5")
    monkeypatch.setattr(config, "CLASSIFIER_MODEL", "claude-haiku-4-5")
    assert RunOptions.resolve(None, None, None).classifier_model == "claude-haiku-4-5"
    ollama = RunOptions.resolve("ollama", "qwen3-vl:30b-instruct", None)
    assert ollama.classifier_model == "qwen3-vl:30b-instruct"
