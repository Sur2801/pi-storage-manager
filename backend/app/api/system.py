from fastapi import APIRouter

from app.schemas.system import SystemStatsResponse

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/stats", response_model=SystemStatsResponse)
def system_stats() -> SystemStatsResponse:
    return SystemStatsResponse(
        message="System stats endpoint is working",
        total_storage="4.0 TB",
        used_storage="1.2 TB",
        available_storage="2.8 TB",
        storage_usage_percentage=30.0,
        cpu_usage_percentage=18.0,
        ram_usage_percentage=42.0,
        uptime="3d 12h",
    )
