from pathlib import Path

from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.schemas.common import BulkOperationResponse, OperationResponse
from app.schemas.files import (
    CopyRequest,
    CreateFileRequest,
    CreateFolderRequest,
    DeleteRequest,
    FileListQuery,
    FileListResponse,
    MoveRequest,
    RenameRequest,
    UploadRequest,
    UploadResponse,
)
from app.services.storage_service import DownloadPreparation, PreviewPreparation, StorageService


class FileService:
    def __init__(self, storage_service: StorageService) -> None:
        self.storage_service = storage_service

    def list_files(self, query: FileListQuery) -> FileListResponse:
        items, total_items = self.storage_service.list_files(query)
        return FileListResponse(
            message="File listing endpoint is working",
            path=query.path,
            search=query.search,
            sort_by=query.sort_by,
            sort_order=query.sort_order,
            include_hidden=query.include_hidden,
            limit=query.limit,
            offset=query.offset,
            total_items=total_items,
            has_more=(query.offset + len(items)) < total_items,
            items=items,
        )

    def create_empty_file(self, request: CreateFileRequest) -> OperationResponse:
        message = self.storage_service.create_empty_file(request.parent_path, request.file_name)
        return OperationResponse(message=message)

    def upload_file(self, request: UploadRequest) -> UploadResponse:
        message = self.storage_service.upload_file(request.destination_path, request.item_name)
        return UploadResponse(
            message=message,
            destination_path=request.destination_path,
            file_name=request.item_name,
            upload_mode="placeholder-json",
        )

    def upload_file_multipart(
        self,
        destination_path: str,
        file_stream,
        file_name: str,
        relative_file_path: str | None = None,
    ) -> UploadResponse:
        message = self.storage_service.upload_file_stream(
            destination_path,
            file_name,
            file_stream,
            relative_file_path=relative_file_path,
        )
        return UploadResponse(
            message=message,
            destination_path=destination_path,
            file_name=file_name,
            upload_mode="multipart-form",
        )

    def download_file(
        self,
        source_path: str | None,
        source_paths: list[str] | None,
        as_archive: bool,
    ) -> FileResponse:
        prepared_download: DownloadPreparation = self.storage_service.prepare_download(
            source_path=source_path,
            source_paths=source_paths,
            as_archive=as_archive,
        )
        background_task = None
        if prepared_download.cleanup_path is not None:
            background_task = BackgroundTask(lambda path=prepared_download.cleanup_path: path.unlink(missing_ok=True))

        return FileResponse(
            path=Path(prepared_download.file_path),
            filename=prepared_download.download_name,
            media_type="application/octet-stream",
            background=background_task,
        )

    def preview_file(self, source_path: str) -> FileResponse:
        prepared_preview: PreviewPreparation = self.storage_service.prepare_preview(source_path)
        return FileResponse(
            path=Path(prepared_preview.file_path),
            media_type=prepared_preview.media_type,
            filename=prepared_preview.file_name,
            content_disposition_type="inline",
        )

    def thumbnail_file(self, source_path: str, width: int, height: int) -> FileResponse:
        prepared_thumbnail = self.storage_service.prepare_thumbnail(source_path, width=width, height=height)
        return FileResponse(
            path=Path(prepared_thumbnail.file_path),
            media_type=prepared_thumbnail.media_type,
            filename=prepared_thumbnail.file_name,
            content_disposition_type="inline",
        )

    def create_folder(self, request: CreateFolderRequest) -> OperationResponse:
        message = self.storage_service.create_folder(request.parent_path, request.folder_name)
        return OperationResponse(message=message)

    def rename_item(self, request: RenameRequest) -> OperationResponse:
        message = self.storage_service.rename_item(request.source_path, request.new_name)
        return OperationResponse(message=message)

    def move_item(self, request: MoveRequest) -> BulkOperationResponse:
        source_paths = request.all_source_paths()
        results = self.storage_service.move_items(source_paths, request.destination_path)
        return BulkOperationResponse(
            success=all(result.success for result in results),
            message="Move operation completed",
            results=results,
        )

    def copy_item(self, request: CopyRequest) -> BulkOperationResponse:
        source_paths = request.all_source_paths()
        results = self.storage_service.copy_items(source_paths, request.destination_path)
        return BulkOperationResponse(
            success=all(result.success for result in results),
            message="Copy operation completed",
            results=results,
        )

    def delete_items(self, request: DeleteRequest) -> BulkOperationResponse:
        results = self.storage_service.delete_items(request.target_paths)
        return BulkOperationResponse(
            success=all(result.success for result in results),
            message="Delete operation completed",
            results=results,
        )
