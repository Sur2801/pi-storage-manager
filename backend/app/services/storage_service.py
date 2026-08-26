from app.schemas.common import BulkOperationItemResult
from app.schemas.files import FileListQuery, FileMetadata


class StorageService:
    def list_files(self, _: FileListQuery) -> list[FileMetadata]:
        return []

    def create_empty_file(self, _: str, __: str) -> str:
        return "Create empty file endpoint is working"

    def upload_file(self, _: str, __: str) -> str:
        return "File upload endpoint is working"

    def upload_file_stream(self, _: str, __: str, ___: str | None = None) -> str:
        return "Multipart upload endpoint is working"

    def download_file(self, _: str, __: bool = False) -> str:
        return "File download endpoint is working"

    def create_folder(self, _: str, __: str) -> str:
        return "Folder creation endpoint is working"

    def rename_item(self, _: str, __: str) -> str:
        return "File rename endpoint is working"

    def move_items(self, source_paths: list[str], _: str) -> list[BulkOperationItemResult]:
        return [BulkOperationItemResult(path=path, success=True) for path in source_paths]

    def copy_items(self, source_paths: list[str], _: str) -> list[BulkOperationItemResult]:
        return [BulkOperationItemResult(path=path, success=True) for path in source_paths]

    def delete_items(self, target_paths: list[str]) -> list[BulkOperationItemResult]:
        return [BulkOperationItemResult(path=path, success=True) for path in target_paths]
