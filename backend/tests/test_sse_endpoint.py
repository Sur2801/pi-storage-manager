from __future__ import annotations

import asyncio
import json

from fastapi.responses import StreamingResponse

from app.api.events import _sse_generator, filesystem_events
from app.services.watcher_service import FsChangeEvent, watcher_service


class _FakeRequest:
    def __init__(self, disconnect_sequence: list[bool] | None = None) -> None:
        self._disconnect_sequence = disconnect_sequence or []
        self._index = 0

    async def is_disconnected(self) -> bool:
        if self._index < len(self._disconnect_sequence):
            value = self._disconnect_sequence[self._index]
            self._index += 1
            return value
        return False


def test_sse_endpoint_content_type() -> None:
    async def run_test() -> None:
        response = await filesystem_events(_FakeRequest())
        assert isinstance(response, StreamingResponse)
        assert response.media_type == "text/event-stream"
        assert response.headers["Cache-Control"] == "no-cache"

    asyncio.run(run_test())


def test_sse_generator_emits_created_event(monkeypatch) -> None:
    async def run_test() -> None:
        queue: asyncio.Queue[FsChangeEvent] = asyncio.Queue()
        unsubscribed: list[asyncio.Queue[FsChangeEvent]] = []

        monkeypatch.setattr(watcher_service, "subscribe", lambda: queue)
        monkeypatch.setattr(watcher_service, "unsubscribe", lambda subscribed_queue: unsubscribed.append(subscribed_queue))

        generator = _sse_generator(_FakeRequest([False, False]), "")
        first_chunk = await generator.__anext__()
        assert first_chunk == ": connected\n\n"

        await queue.put(
            FsChangeEvent(
                event_type="created",
                src_path="Photos/new-file.jpg",
                dest_path=None,
                is_directory=False,
            )
        )

        second_chunk = await asyncio.wait_for(generator.__anext__(), timeout=1)
        payload = json.loads(second_chunk.removeprefix("data: ").strip())

        assert payload["event_type"] == "created"
        assert payload["src_path"] == "Photos/new-file.jpg"

        await generator.aclose()
        assert unsubscribed == [queue]

    asyncio.run(run_test())


def test_sse_generator_filters_unrelated_paths(monkeypatch) -> None:
    async def run_test() -> None:
        queue: asyncio.Queue[FsChangeEvent] = asyncio.Queue()

        monkeypatch.setattr(watcher_service, "subscribe", lambda: queue)
        monkeypatch.setattr(watcher_service, "unsubscribe", lambda subscribed_queue: None)

        generator = _sse_generator(_FakeRequest([False, False, False]), "watched")
        await generator.__anext__()

        await queue.put(
            FsChangeEvent(
                event_type="created",
                src_path="other/ignored.txt",
                dest_path=None,
                is_directory=False,
            )
        )
        await queue.put(
            FsChangeEvent(
                event_type="created",
                src_path="watched/relevant.txt",
                dest_path=None,
                is_directory=False,
            )
        )

        chunk = await asyncio.wait_for(generator.__anext__(), timeout=1)
        payload = json.loads(chunk.removeprefix("data: ").strip())

        assert payload["src_path"] == "watched/relevant.txt"

        await generator.aclose()

    asyncio.run(run_test())


def test_sse_generator_disconnect_cleans_up_subscription(monkeypatch) -> None:
    async def run_test() -> None:
        queue: asyncio.Queue[FsChangeEvent] = asyncio.Queue()
        unsubscribed: list[asyncio.Queue[FsChangeEvent]] = []

        monkeypatch.setattr(watcher_service, "subscribe", lambda: queue)
        monkeypatch.setattr(watcher_service, "unsubscribe", lambda subscribed_queue: unsubscribed.append(subscribed_queue))

        generator = _sse_generator(_FakeRequest([True]), "")
        first_chunk = await generator.__anext__()
        assert first_chunk == ": connected\n\n"

        try:
            await generator.__anext__()
        except StopAsyncIteration:
            pass

        assert unsubscribed == [queue]

    asyncio.run(run_test())
