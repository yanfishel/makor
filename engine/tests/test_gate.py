"""Admission control (app/gate.py) and its HTTP mapping in app/main.py."""

import asyncio
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from app import config, main
from app.gate import AdmissionGate, Overloaded
from tests.conftest import post_image


async def _hold(gate: AdmissionGate, release: asyncio.Event, entered: asyncio.Event):
    async with gate.slot():
        entered.set()
        await release.wait()


def test_gate_queues_up_to_max_waiting_and_rejects_the_rest():
    async def scenario():
        gate = AdmissionGate(limit=1, max_waiting=2)
        release, entered = asyncio.Event(), asyncio.Event()
        holder = asyncio.create_task(_hold(gate, release, entered))
        await entered.wait()
        assert gate.active == 1 and gate.waiting == 0

        waiters = [asyncio.create_task(_hold(gate, release, asyncio.Event())) for _ in range(2)]
        await asyncio.sleep(0)  # let them reach the semaphore
        assert gate.waiting == 2

        with pytest.raises(Overloaded):
            async with gate.slot():
                pass

        release.set()
        await asyncio.gather(holder, *waiters)
        assert gate.active == 0 and gate.waiting == 0

    asyncio.run(scenario())


def test_gate_admits_up_to_limit_without_queueing():
    async def scenario():
        gate = AdmissionGate(limit=2, max_waiting=0)
        release = asyncio.Event()
        entered = [asyncio.Event(), asyncio.Event()]
        tasks = [asyncio.create_task(_hold(gate, release, e)) for e in entered]
        await asyncio.gather(*(e.wait() for e in entered))
        assert gate.active == 2
        with pytest.raises(Overloaded):
            async with gate.slot():
                pass
        release.set()
        await asyncio.gather(*tasks)

    asyncio.run(scenario())


def test_gate_counters_recover_after_an_exception_inside_the_slot():
    async def scenario():
        gate = AdmissionGate(limit=1, max_waiting=0)
        with pytest.raises(ValueError):
            async with gate.slot():
                raise ValueError("boom")
        assert gate.active == 0 and gate.waiting == 0
        async with gate.slot():
            assert gate.active == 1

    asyncio.run(scenario())


def test_gate_rejects_bad_sizes():
    with pytest.raises(ValueError):
        AdmissionGate(limit=0, max_waiting=1)
    with pytest.raises(ValueError):
        AdmissionGate(limit=1, max_waiting=-1)


# --- HTTP layer -----------------------------------------------------------------


class _FullGate:
    active, waiting, limit, max_waiting = 1, 4, 1, 4

    @asynccontextmanager
    async def slot(self):
        raise Overloaded
        yield  # pragma: no cover

    def snapshot(self):
        return {"active": 1, "waiting": 4, "limit": 1, "max_waiting": 4}


def test_extract_returns_503_with_retry_after_when_the_queue_is_full(client, monkeypatch):
    monkeypatch.setattr(main, "gate", _FullGate())
    resp = post_image(client)
    assert resp.status_code == 503
    assert resp.headers["retry-after"] == str(config.OVERLOAD_RETRY_AFTER_SECONDS)
    assert "busy" in resp.json()["detail"].lower()


def test_prod_without_secret_refuses_to_start(app_env, monkeypatch):
    monkeypatch.setattr(config, "ENV", "prod")
    with pytest.raises(RuntimeError, match="MAKOR_ENGINE_SECRET"):
        with TestClient(main.app):
            pass


def test_no_secret_configured_reaches_the_gate(client, monkeypatch):
    monkeypatch.setattr(main, "gate", _FullGate())  # stop before any model call
    assert post_image(client).status_code == 503  # got past the secret check, hit the gate


def test_healthz_reports_queue_state(client):
    body = client.get("/healthz").json()
    assert body["status"] == "ok"
    assert body["queue"] == {"active": 0, "waiting": 0, "limit": config.MAX_CONCURRENCY, "max_waiting": config.MAX_QUEUE}


def test_healthz_says_whether_the_engine_holds_an_anthropic_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    assert client.get("/healthz").json()["anthropic_key"] is False
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    assert client.get("/healthz").json()["anthropic_key"] is True


def test_would_reject_mirrors_slot_admission():
    async def scenario():
        gate = AdmissionGate(limit=1, max_waiting=0)
        assert gate.would_reject() is False
        release, entered = asyncio.Event(), asyncio.Event()
        holder = asyncio.create_task(_hold(gate, release, entered))
        await entered.wait()
        assert gate.would_reject() is True
        release.set()
        await holder
        assert gate.would_reject() is False

    asyncio.run(scenario())
