import os
import shutil
import time
from pathlib import Path

import psutil
from fastapi import APIRouter

from app.core.config import settings
from app.schemas.system import SystemStatsResponse

router = APIRouter(prefix="/system", tags=["system"])

_STORAGE_ROOT_CACHE_TTL_SECONDS = 5.0
_STORAGE_ROOT_STATS_CACHE: dict[str, tuple[float, int, int, int]] = {}


def _to_gb(value: float | int) -> float:
    return round(float(value) / (1024 ** 3), 2)


def clear_storage_root_cache() -> None:
    _STORAGE_ROOT_STATS_CACHE.clear()


def _get_storage_root_stats(root_path: Path) -> tuple[int, int, int]:
    cache_key = str(root_path.expanduser().resolve())
    now = time.monotonic()
    cached = _STORAGE_ROOT_STATS_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _STORAGE_ROOT_CACHE_TTL_SECONDS:
        return cached[1], cached[2], cached[3]

    total_bytes, file_count, folder_count = _calculate_storage_root_stats(root_path)
    _STORAGE_ROOT_STATS_CACHE[cache_key] = (now, total_bytes, file_count, folder_count)
    return total_bytes, file_count, folder_count


def _calculate_storage_root_stats(root_path: Path) -> tuple[int, int, int]:
    total_bytes = 0
    file_count = 0
    folder_count = 0

    if not root_path.exists() or not root_path.is_dir():
        return total_bytes, file_count, folder_count

    stack: list[Path] = [root_path]
    while stack:
        current_path = stack.pop()
        try:
            with os.scandir(current_path) as entries:
                for entry in entries:
                    try:
                        if entry.is_symlink():
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            folder_count += 1
                            stack.append(Path(entry.path))
                            continue
                        if entry.is_file(follow_symlinks=False):
                            file_count += 1
                            try:
                                total_bytes += entry.stat(follow_symlinks=False).st_size
                            except OSError:
                                continue
                    except OSError:
                        continue
        except OSError:
            continue

    return total_bytes, file_count, folder_count


@router.get("/stats", response_model=SystemStatsResponse, response_model_exclude_none=True)
def system_stats() -> SystemStatsResponse:
    storage_root = Path(settings.storage_root).expanduser()

    storage_root_used_bytes, storage_root_file_count, storage_root_folder_count = _get_storage_root_stats(storage_root)
    storage_root_used_gb = _to_gb(storage_root_used_bytes)

    total_bytes = 0
    used_bytes = 0
    free_bytes = 0
    try:
        total_bytes, used_bytes, free_bytes = shutil.disk_usage(str(storage_root))
    except OSError:
        total_bytes, used_bytes, free_bytes = 0, 0, 0

    volume_total_gb = _to_gb(total_bytes)
    volume_used_gb = _to_gb(used_bytes)
    volume_available_gb = _to_gb(free_bytes)
    volume_usage_percentage = 0.0 if total_bytes <= 0 else round((used_bytes / total_bytes) * 100.0, 2)

    cpu_percentage = float(psutil.cpu_percent(interval=None))
    memory = psutil.virtual_memory()
    ram_percentage = float(memory.percent)
    uptime_seconds = time.time() - psutil.boot_time()
    days, remainder = divmod(int(uptime_seconds), 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, _ = divmod(remainder, 60)
    uptime_parts = []
    if days:
        uptime_parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours:
        uptime_parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if minutes and not days:
        uptime_parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    uptime_value = " ".join(uptime_parts) if uptime_parts else "0 minutes"

    return SystemStatsResponse(
        success=True,
        storage_root={
            "used_bytes": storage_root_used_bytes,
            "used_gb": storage_root_used_gb,
            "file_count": storage_root_file_count,
            "folder_count": storage_root_folder_count,
        },
        volume={
            "total_bytes": int(total_bytes),
            "used_bytes": int(used_bytes),
            "available_bytes": int(free_bytes),
            "usage_percentage": volume_usage_percentage,
            "total_gb": volume_total_gb,
            "used_gb": volume_used_gb,
            "available_gb": volume_available_gb,
        },
        storage_root_used_bytes=storage_root_used_bytes,
        storage_root_used_gb=storage_root_used_gb,
        storage_root_file_count=storage_root_file_count,
        storage_root_folder_count=storage_root_folder_count,
        volume_total_bytes=int(total_bytes),
        volume_used_bytes=int(used_bytes),
        volume_available_bytes=int(free_bytes),
        volume_usage_percentage=volume_usage_percentage,
        volume_total_gb=volume_total_gb,
        volume_used_gb=volume_used_gb,
        volume_available_gb=volume_available_gb,
        total_storage_gb=volume_total_gb,
        used_storage_gb=volume_used_gb,
        available_storage_gb=volume_available_gb,
        total_storage=f"{volume_total_gb:.1f} GB",
        used_storage=f"{volume_used_gb:.1f} GB",
        available_storage=f"{volume_available_gb:.1f} GB",
        storage_usage_percentage=volume_usage_percentage,
        cpu_usage_percentage=round(cpu_percentage, 2),
        ram_usage_percentage=round(ram_percentage, 2),
        uptime=uptime_value,
    )
