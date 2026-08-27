from pydantic import BaseModel


class StorageRootStats(BaseModel):
    used_gb: float | None = None
    file_count: int | None = None
    folder_count: int | None = None


class VolumeStats(BaseModel):
    total_gb: float | None = None
    used_gb: float | None = None
    available_gb: float | None = None
    usage_percentage: float | None = None


class SystemStatsResponse(BaseModel):
    success: bool = True
    message: str | None = None
    storage_root: StorageRootStats | None = None
    volume: VolumeStats | None = None

    storage_root_used_gb: float | None = None
    storage_root_file_count: int | None = None
    storage_root_folder_count: int | None = None

    volume_total_gb: float | None = None
    volume_used_gb: float | None = None
    volume_available_gb: float | None = None
    volume_usage_percentage: float | None = None

    total_storage_gb: float | None = None
    used_storage_gb: float | None = None
    available_storage_gb: float | None = None
    total_storage: str | None = None
    used_storage: str | None = None
    available_storage: str | None = None
    storage_usage_percentage: float | None = None
    cpu_usage_percentage: float | None = None
    ram_usage_percentage: float | None = None
    uptime: str | None = None
