from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import OperationResponse


SortBy = Literal["name", "type", "size", "modified_at"]
SortOrder = Literal["asc", "desc"]


class FileListQuery(BaseModel):
    path: str = Field(default="/", min_length=1)
    search: str | None = None
    sort_by: SortBy = "name"
    sort_order: SortOrder = "asc"


class FileMetadata(BaseModel):
    name: str
    path: str
    is_directory: bool
    type: str
    extension: str | None = None
    size: int | None = None
    modified_at: str | None = None


class FileListResponse(OperationResponse):
    path: str
    search: str | None = None
    sort_by: SortBy
    sort_order: SortOrder
    items: list[FileMetadata] = Field(default_factory=list)


class UploadRequest(BaseModel):
    destination_path: str = Field(default="/", min_length=1)
    item_name: str = Field(min_length=1)


class UploadResponse(OperationResponse):
    destination_path: str
    file_name: str
    upload_mode: Literal["placeholder-json", "multipart-form"]
    content_type: str | None = None


class DownloadResponse(OperationResponse):
    source_path: str
    download_mode: Literal["single", "archive"]


class CreateFileRequest(BaseModel):
    parent_path: str = Field(default="/", min_length=1)
    file_name: str = Field(min_length=1)


class CreateFolderRequest(BaseModel):
    parent_path: str = Field(default="/", min_length=1)
    folder_name: str = Field(min_length=1)


class RenameRequest(BaseModel):
    source_path: str = Field(min_length=1)
    new_name: str = Field(min_length=1)


class SourcePathsRequest(BaseModel):
    source_path: str | None = Field(default=None, min_length=1)
    source_paths: list[str] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_source_paths(self) -> "SourcePathsRequest":
        if not self.source_path and not self.source_paths:
            raise ValueError("Provide source_path or source_paths.")
        return self

    def all_source_paths(self) -> list[str]:
        combined_paths: list[str] = []
        if self.source_path:
            combined_paths.append(self.source_path)
        if self.source_paths:
            combined_paths.extend(self.source_paths)

        unique_paths: list[str] = []
        for path in combined_paths:
            if path not in unique_paths:
                unique_paths.append(path)
        return unique_paths


class MoveRequest(SourcePathsRequest):
    destination_path: str = Field(min_length=1)


class CopyRequest(SourcePathsRequest):
    destination_path: str = Field(min_length=1)


class DeleteRequest(BaseModel):
    target_paths: list[str] = Field(min_length=1)
