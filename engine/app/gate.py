"""Admission control in front of the extraction pipeline.

Ollama serves vision models strictly one request at a time (it forces
num_parallel=1 for them), so concurrent uploads would only pile up inside Ollama
and the last one would run into OLLAMA_TIMEOUT_SECONDS after minutes of waiting.
The gate keeps a short queue in the app instead and rejects immediately once it
is full, so a client gets a fast 503 + Retry-After rather than a slow timeout.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager


class Overloaded(Exception):
    """Every slot is busy and the waiting queue is full."""


class AdmissionGate:
    def __init__(self, limit: int, max_waiting: int):
        if limit < 1:
            raise ValueError("limit must be >= 1")
        if max_waiting < 0:
            raise ValueError("max_waiting must be >= 0")
        self.limit = limit
        self.max_waiting = max_waiting
        self.active = 0
        self.waiting = 0
        self._slots = asyncio.Semaphore(limit)

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        if self.would_reject():
            raise Overloaded
        self.waiting += 1
        try:
            await self._slots.acquire()
        finally:
            self.waiting -= 1
        self.active += 1
        try:
            yield
        finally:
            self.active -= 1
            self._slots.release()

    def would_reject(self) -> bool:
        """What slot() would do right now: every slot busy and the queue full. Lets the
        streaming form of /extract answer a plain 503 before its response starts."""
        return self._slots.locked() and self.waiting >= self.max_waiting

    def snapshot(self) -> dict[str, int]:
        return {"active": self.active, "waiting": self.waiting, "limit": self.limit, "max_waiting": self.max_waiting}
