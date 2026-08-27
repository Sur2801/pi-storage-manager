"""SSE endpoint for filesystem change notifications.

Clients connect to GET /api/events and receive newline-delimited SSE frames
whenever the watcher detects a filesystem change under STORAGE_ROOT.

The optional `path` query param lets the client declare which directory it is
currently viewing; only events whose src_path starts with that prefix are
forwarded, avoiding unnecessary refreshes for unrelated directories.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app.services.watcher_service import FsChangeEvent, watcher_service

router = APIRouter(tags=["events"])

_KEEPALIVE_INTERVAL = 15  # seconds between keepalive pings


def _event_relevant(event: FsChangeEvent, watched_prefix: str) -> bool:
    """Return True if the event concerns the directory the client is viewing."""
    if not watched_prefix:
        # Client is at root — all events are relevant
        return True
    src = event.src_path.lstrip("/")
    dest = (event.dest_path or "").lstrip("/")
    prefix = watched_prefix.lstrip("/")
    return src.startswith(prefix) or dest.startswith(prefix)


async def _sse_generator(
    request: Request,
    watched_path: str,
) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted strings until the client disconnects."""
    queue = watcher_service.subscribe()
    try:
        yield ": connected\n\n"
        while True:
            if await request.is_disconnected():
                break

            try:
                event: FsChangeEvent = await asyncio.wait_for(
                    queue.get(), timeout=_KEEPALIVE_INTERVAL
                )
                if _event_relevant(event, watched_path):
                    payload = json.dumps(event.model_dump())
                    yield f"data: {payload}\n\n"
            except asyncio.TimeoutError:
                # Send a keepalive comment to prevent proxy/browser timeouts
                yield ": keepalive\n\n"
    finally:
        watcher_service.unsubscribe(queue)


@router.get("/events")
async def filesystem_events(
    request: Request,
    path: str = Query(default="", description="Current directory path (relative to STORAGE_ROOT)"),
) -> StreamingResponse:
    """Stream filesystem change events as Server-Sent Events.

    The client should reconnect automatically (EventSource does this by default).
    """
    return StreamingResponse(
        _sse_generator(request, path),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering if proxied
        },
    )
