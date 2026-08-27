import os
import shutil
import time
from pathlib import Path

import psutil
from fastapi import APIRouter

from app.core.config import settings
from app.schemas.system import SystemStatsResponse

router = APIRouter(prefix="/system", tags=["system"])


def _to_gb(value: float) -> float:
    return round(value / (1024 ** 3), 2)


def _calculate_storage_root_stats(root_path: Path) -> tuple[float, int, int]:
    total_bytes = 0.0
    file_count = 0
    folder_count = 0

    if not root_path.exists() or not root_path.is_dir():
        return total_bytes, file_count, folder_count

    def walk(current_path: Path) -> None:
        nonlocal total_bytes, file_count, folder_count

        try:
            with os.scandir(current_path) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            folder_count += 1
                            walk(Path(entry.path))
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
            return

    walk(root_path)
    return total_bytes, file_count, folder_count


@router.get("/stats", response_model=SystemStatsResponse, response_model_exclude_none=True)
def system_stats() -> SystemStatsResponse:
    storage_root = Path(settings.storage_root).expanduser()

    storage_root_used_bytes, storage_root_file_count, storage_root_folder_count = _calculate_storage_root_stats(storage_root)
    storage_root_used_gb = _to_gb(storage_root_used_bytes)

    total, used, free = 0.0, 0.0, 0.0
    try:
        total_bytes, used_bytes, free_bytes = shutil.disk_usage(str(storage_root))
        total = float(total_bytes)
        used = float(used_bytes)
        free = float(free_bytes)
    except OSError:
        total = 0.0
        used = 0.0
        free = 0.0

    volume_total_gb = _to_gb(total)
    volume_used_gb = _to_gb(used)
    volume_available_gb = _to_gb(free)
    volume_usage_percentage = 0.0 if total <= 0 else round((used / total) * 100.0, 2)

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
            "used_gb": storage_root_used_gb,
            "file_count": storage_root_file_count,
            "folder_count": storage_root_folder_count,
        },
        volume={
            "total_gb": volume_total_gb,
            "used_gb": volume_used_gb,
            "available_gb": volume_available_gb,
            "usage_percentage": volume_usage_percentage,
        },
        storage_root_used_gb=storage_root_used_gb,
        storage_root_file_count=storage_root_file_count,
        storage_root_folder_count=storage_root_folder_count,
        volume_total_gb=volume_total_gb,
        volume_used_gb=volume_used_gb,
        volume_available_gb=volume_available_gb,
        volume_usage_percentage=volume_usage_percentage,
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
