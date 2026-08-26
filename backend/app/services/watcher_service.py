"""Single-process filesystem watcher that bridges watchdog events into asyncio queues.

There is ONE WatcherService instance for the entire server process. Subscribers
(SSE clients) each get their own asyncio.Queue that receives FsChangeEvent objects.
"""
from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from watchdog.events import (
    DirCreatedEvent,
    DirDeletedEvent,
    DirModifiedEvent,
    DirMovedEvent,
    FileCreatedEvent,
    FileDeletedEvent,
    FileModifiedEvent,
    FileMovedEvent,
    FileSystemEvent,
    FileSystemEventHandler,
)
from watchdog.observers import Observer


class FsChangeEvent(BaseModel):
    event_type: Literal["created", "deleted", "modified", "moved"]
    src_path: str
    dest_path: str | None = None
    is_directory: bool


class _StorageEventHandler(FileSystemEventHandler):
    """Watchdog handler that converts OS events into FsChangeEvent objects
    and forwards them to all registered asyncio queues via call_soon_threadsafe."""

    def __init__(
        self,
        storage_root: Path,
        get_queues: object,
        queues_lock: threading.Lock,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        super().__init__()
        self._root = storage_root
        self._get_queues = get_queues  # callable returning set of queues
        self._lock = queues_lock
        self._loop = loop

    def _make_relative(self, abs_path: str) -> str:
        try:
            return str(Path(abs_path).relative_to(self._root).as_posix())
        except ValueError:
            return abs_path

    def _broadcast(self, event: FsChangeEvent) -> None:
        with self._lock:
            queues = set(self._get_queues())  # type: ignore[call-arg]
        for queue in queues:
            self._loop.call_soon_threadsafe(queue.put_nowait, event)

    def on_created(self, event: FileSystemEvent) -> None:
        self._broadcast(
            FsChangeEvent(
                event_type="created",
                src_path=self._make_relative(str(event.src_path)),
                is_directory=isinstance(event, DirCreatedEvent),
            )
        )

    def on_deleted(self, event: FileSystemEvent) -> None:
        self._broadcast(
            FsChangeEvent(
                event_type="deleted",
                src_path=self._make_relative(str(event.src_path)),
                is_directory=isinstance(event, DirDeletedEvent),
            )
        )

    def on_modified(self, event: FileSystemEvent) -> None:
        # Skip directory modified events — too noisy (triggered by child changes)
        if isinstance(event, DirModifiedEvent):
            return
        self._broadcast(
            FsChangeEvent(
                event_type="modified",
                src_path=self._make_relative(str(event.src_path)),
                is_directory=isinstance(event, FileModifiedEvent) is False,
            )
        )

    def on_moved(self, event: FileSystemEvent) -> None:
        dest = getattr(event, "dest_path", None)
        self._broadcast(
            FsChangeEvent(
                event_type="moved",
                src_path=self._make_relative(str(event.src_path)),
                dest_path=self._make_relative(str(dest)) if dest else None,
                is_directory=isinstance(event, DirMovedEvent),
            )
        )


class WatcherService:
    """Process-level singleton that owns one watchdog Observer."""

    def __init__(self) -> None:
        self._observer: Observer | None = None
        self._queues: set[asyncio.Queue[FsChangeEvent]] = set()
        self._lock = threading.Lock()

    def start(self, storage_root: Path, loop: asyncio.AbstractEventLoop) -> None:
        if self._observer is not None:
            return  # Already running

        handler = _StorageEventHandler(
            storage_root=storage_root,
            get_queues=self._queues.copy,
            queues_lock=self._lock,
            loop=loop,
        )
        observer = Observer()
        observer.schedule(handler, str(storage_root), recursive=True)
        observer.start()
        self._observer = observer

    def stop(self) -> None:
        if self._observer is None:
            return
        self._observer.stop()
        self._observer.join()
        self._observer = None

    def subscribe(self) -> asyncio.Queue[FsChangeEvent]:
        queue: asyncio.Queue[FsChangeEvent] = asyncio.Queue()
        with self._lock:
            self._queues.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[FsChangeEvent]) -> None:
        with self._lock:
            self._queues.discard(queue)


# Module-level singleton — import this everywhere
watcher_service = WatcherService()
