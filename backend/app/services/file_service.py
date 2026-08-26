from app.schemas.files import (
    CopyRequest,
    CreateFolderRequest,
    DeleteRequest,
    FileListQuery,
    MoveRequest,
    RenameRequest,
    UploadRequest,
)
from app.services.storage_service import StorageService


class FileService:
    def __init__(self, storage_service: StorageService) -> None:
        self.storage_service = storage_service

    def list_files(self, request: FileListQuery) -> str:
        return self.storage_service.list_files(request.path)

    def upload_file(self, request: UploadRequest) -> str:
        return self.storage_service.upload_file(request.destination_path, request.item_name)

    def download_file(self, source_path: str) -> str:
        return self.storage_service.download_file(source_path)

    def create_folder(self, request: CreateFolderRequest) -> str:
        return self.storage_service.create_folder(request.parent_path, request.folder_name)

    def rename_item(self, request: RenameRequest) -> str:
        return self.storage_service.rename_item(request.source_path, request.new_name)

    def move_item(self, request: MoveRequest) -> str:
        return self.storage_service.move_item(request.source_path, request.destination_path)

    def copy_item(self, request: CopyRequest) -> str:
        return self.storage_service.copy_item(request.source_path, request.destination_path)

    def delete_items(self, request: DeleteRequest) -> str:
        return self.storage_service.delete_items(request.target_paths)

