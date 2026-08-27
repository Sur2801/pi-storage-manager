"""Tests for WatcherService filesystem event generation.

These tests write real files to tmp_path and verify that the watcher emits
the correct FsChangeEvent objects. They do NOT use the real STORAGE_ROOT.
"""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from app.services.watcher_service import FsChangeEvent, WatcherService


def _new_loop() -> asyncio.AbstractEventLoop:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    return loop


def _run(coro, loop: asyncio.AbstractEventLoop = None):
    if loop is None:
        loop = asyncio.get_event_loop()
    return loop.run_until_complete(coro)


@pytest.fixture
def watcher_loop(tmp_path: Path):
    """Start a fresh WatcherService against tmp_path; stop it after the test."""
    loop = _new_loop()
    svc = WatcherService()
    svc.start(tmp_path, loop)
    time.sleep(0.3)
    yield svc, loop, tmp_path
    svc.stop()
    loop.close()


def test_watcher_start_stop_is_clean(tmp_path: Path) -> None:
    loop = _new_loop()
    svc = WatcherService()
    svc.start(tmp_path, loop)
    time.sleep(0.1)
    svc.stop()
    loop.close()


def test_watcher_double_start_is_safe(tmp_path: Path) -> None:
    loop = _new_loop()
    svc = WatcherService()
    svc.start(tmp_path, loop)
    first_observer = svc._observer
    svc.start(tmp_path, loop)  # Second call should be a no-op
    assert svc._observer is first_observer
    svc.stop()
    loop.close()


def test_watcher_emits_created_event(watcher_loop) -> None:
    svc, loop, tmp_path = watcher_loop
    queue = svc.subscribe()

    new_file = tmp_path / "hello.txt"
    new_file.write_text("hello")

    async def _collect():
        return await asyncio.wait_for(queue.get(), timeout=3.0)

    event: FsChangeEvent = _run(_collect(), loop)
    assert event.event_type == "created"
    assert "hello.txt" in event.src_path
    assert event.is_directory is False

    svc.unsubscribe(queue)


def test_watcher_emits_deleted_event(watcher_loop) -> None:
    svc, loop, tmp_path = watcher_loop
    existing = tmp_path / "to-delete.txt"
    existing.write_text("bye")
    time.sleep(0.3)

    queue = svc.subscribe()
    existing.unlink()

    async def _collect():
        for _ in range(10):
            ev: FsChangeEvent = await asyncio.wait_for(queue.get(), timeout=3.0)
            if ev.event_type == "deleted":
                return ev
        return None

    event = _run(_collect(), loop)
    assert event is not None
    assert event.event_type == "deleted"
    assert "to-delete.txt" in event.src_path

    svc.unsubscribe(queue)


def test_multiple_subscribers_all_receive_event(watcher_loop) -> None:
    svc, loop, tmp_path = watcher_loop
    q1 = svc.subscribe()
    q2 = svc.subscribe()

    (tmp_path / "shared.txt").write_text("data")

    async def _collect_both():
        e1 = await asyncio.wait_for(q1.get(), timeout=3.0)
        e2 = await asyncio.wait_for(q2.get(), timeout=3.0)
        return e1, e2

    ev1, ev2 = _run(_collect_both(), loop)
    assert "shared.txt" in ev1.src_path
    assert "shared.txt" in ev2.src_path

    svc.unsubscribe(q1)
    svc.unsubscribe(q2)


def test_unsubscribe_stops_delivery(watcher_loop) -> None:
    svc, loop, tmp_path = watcher_loop
    queue = svc.subscribe()
    svc.unsubscribe(queue)

    (tmp_path / "no-delivery.txt").write_text("x")
    time.sleep(0.5)

    assert queue.empty()

