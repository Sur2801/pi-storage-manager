import shutil
import time
from pathlib import Path

import psutil
from fastapi import APIRouter

from app.core.config import settings
from app.schemas.system import SystemStatsResponse

router = APIRouter(prefix="/system", tags=["system"])


def _format_bytes(value: float) -> str:
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    size = float(value)
    unit_index = 0
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    if unit_index == 0:
        return f"{int(size)} {units[unit_index]}"
    return f"{size:.1f} {units[unit_index]}"


@router.get("/stats", response_model=SystemStatsResponse)
def system_stats() -> SystemStatsResponse:
    storage_root = Path(settings.storage_root).expanduser()
    total, used, free = 0, 0, 0
    try:
        total_bytes, used_bytes, free_bytes = shutil.disk_usage(str(storage_root))
        total = float(total_bytes)
        used = float(used_bytes)
        free = float(free_bytes)
    except OSError:
        total = 0.0
        used = 0.0
        free = 0.0

    storage_percentage = 0.0 if total <= 0 else (used / total) * 100.0
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
        message="System stats loaded.",
        total_storage=_format_bytes(total),
        used_storage=_format_bytes(used),
        available_storage=_format_bytes(free),
        storage_usage_percentage=round(storage_percentage, 2),
        cpu_usage_percentage=round(cpu_percentage, 2),
        ram_usage_percentage=round(ram_percentage, 2),
        uptime=uptime_value,
    )
