from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.events import router as events_router
from app.api.files import router as files_router
from app.api.folders import router as folders_router
from app.api.health import router as health_router
from app.api.system import router as system_router
from app.core.config import settings
from app.core.exception_handlers import register_exception_handlers
from app.services.watcher_service import watcher_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage_root = Path(settings.storage_root).expanduser().resolve()
    if storage_root.exists():
        loop = asyncio.get_running_loop()
        watcher_service.start(storage_root, loop)
    yield
    watcher_service.stop()


app = FastAPI(
    title="Pi Storage Manager API",
    version="0.1.0",
    description="Initial API skeleton for Pi Storage Manager.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Type"],
)

register_exception_handlers(app)

app.include_router(health_router)
app.include_router(files_router, prefix=settings.api_prefix)
app.include_router(folders_router, prefix=settings.api_prefix)
app.include_router(system_router, prefix=settings.api_prefix)
app.include_router(events_router, prefix=settings.api_prefix)

frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
