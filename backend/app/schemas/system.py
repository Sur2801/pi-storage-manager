from app.schemas.common import OperationResponse


class SystemStatsResponse(OperationResponse):
    total_storage: str | None = None
    used_storage: str | None = None
    available_storage: str | None = None
    storage_usage_percentage: float | None = None
    cpu_usage_percentage: float | None = None
    ram_usage_percentage: float | None = None
    uptime: str | None = None
