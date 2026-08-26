from fastapi import APIRouter

from app.schemas.system import SystemStatsResponse

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/stats", response_model=SystemStatsResponse)
def system_stats() -> SystemStatsResponse:
    return SystemStatsResponse(message="System stats endpoint is working")

