from app.schemas.common import BulkOperationResponse, OperationResponse
from app.schemas.files import (
    CopyRequest,
    CreateFileRequest,
    CreateFolderRequest,
    DeleteRequest,
    DownloadResponse,
    FileListQuery,
    FileListResponse,
    MoveRequest,
    RenameRequest,
    UploadRequest,
    UploadResponse,
)
from app.services.storage_service import StorageService


class FileService:
    def __init__(self, storage_service: StorageService) -> None:
        self.storage_service = storage_service

    def list_files(self, query: FileListQuery) -> FileListResponse:
        items = self.storage_service.list_files(query)
        return FileListResponse(
            message="File listing endpoint is working",
            path=query.path,
            search=query.search,
            sort_by=query.sort_by,
            sort_order=query.sort_order,
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
        file_name: str,
        content_type: str | None = None,
    ) -> UploadResponse:
        message = self.storage_service.upload_file_stream(destination_path, file_name, content_type)
        return UploadResponse(
            message=message,
            destination_path=destination_path,
            file_name=file_name,
            upload_mode="multipart-form",
            content_type=content_type,
        )

    def download_file(self, source_path: str, as_archive: bool) -> DownloadResponse:
        message = self.storage_service.download_file(source_path, as_archive)
        return DownloadResponse(
            message=message,
            source_path=source_path,
            download_mode="archive" if as_archive else "single",
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
        return BulkOperationResponse(message="Move operation completed", results=results)

    def copy_item(self, request: CopyRequest) -> BulkOperationResponse:
        source_paths = request.all_source_paths()
        results = self.storage_service.copy_items(source_paths, request.destination_path)
        return BulkOperationResponse(message="Copy operation completed", results=results)

    def delete_items(self, request: DeleteRequest) -> BulkOperationResponse:
        results = self.storage_service.delete_items(request.target_paths)
        return BulkOperationResponse(message="Delete operation completed", results=results)
