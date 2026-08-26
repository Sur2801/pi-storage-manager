from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from app.core.config import settings
from app.core.exceptions import AppException
from app.schemas.common import BulkOperationItemResult
from app.schemas.files import FileListQuery, FileMetadata


class StorageService:
    def _storage_root(self) -> Path:
        root = Path(settings.storage_root).expanduser()
        if not root.exists():
            raise AppException(
                message="Storage root is not available.",
                code="STORAGE_ROOT_MISSING",
                status_code=500,
            )
        if not root.is_dir():
            raise AppException(
                message="Storage root is not a directory.",
                code="STORAGE_ROOT_INVALID",
                status_code=500,
            )
        return root.resolve()

    def _normalize_relative_path(self, raw_path: str | None) -> str:
        if raw_path is None:
            return ""

        candidate = raw_path.strip().replace("\\", "/")
        if candidate in {"", "/", "."}:
            return ""

        if candidate.startswith("/") or candidate.startswith("\\"):
            raise AppException(
                message="Path must be relative to storage root.",
                code="ABSOLUTE_PATH_NOT_ALLOWED",
                status_code=400,
            )
        if len(candidate) >= 2 and candidate[1] == ":":
            raise AppException(
                message="Path must be relative to storage root.",
                code="ABSOLUTE_PATH_NOT_ALLOWED",
                status_code=400,
            )

        posix_path = PurePosixPath(candidate)
        normalized_parts = []
        for part in posix_path.parts:
            if part in {"", "."}:
                continue
            if part == "..":
                raise AppException(
                    message="Path traversal is not allowed.",
                    code="PATH_TRAVERSAL_BLOCKED",
                    status_code=403,
                )
            normalized_parts.append(part)

        return "/".join(normalized_parts)

    def _resolve_directory(self, relative_path: str) -> tuple[Path, Path]:
        root = self._storage_root()
        target = (root / Path(relative_path)).resolve()

        if root != target and root not in target.parents:
            raise AppException(
                message="Requested path is outside storage root.",
                code="PATH_OUTSIDE_STORAGE_ROOT",
                status_code=403,
            )
        if not target.exists():
            raise AppException(
                message="Requested directory was not found.",
                code="DIRECTORY_NOT_FOUND",
                status_code=404,
            )
        if not target.is_dir():
            raise AppException(
                message="Requested path is not a directory.",
                code="INVALID_DIRECTORY_PATH",
                status_code=400,
            )
        return root, target

    @staticmethod
    def _file_type_from_extension(extension: str | None) -> str:
        if not extension:
            return "File"

        extension_map = {
            ".txt": "Text File",
            ".md": "Markdown File",
            ".pdf": "PDF File",
            ".zip": "ZIP Archive",
            ".jpg": "Image",
            ".jpeg": "Image",
            ".png": "Image",
            ".gif": "Image",
            ".bmp": "Image",
            ".svg": "Image",
            ".mp3": "Audio",
            ".wav": "Audio",
            ".mp4": "Video",
            ".mkv": "Video",
            ".avi": "Video",
            ".csv": "CSV File",
            ".json": "JSON File",
            ".py": "Python File",
            ".ts": "TypeScript File",
            ".tsx": "TypeScript File",
            ".js": "JavaScript File",
        }
        return extension_map.get(extension.lower(), "File")

    def _sort_file_items(self, items: list[FileMetadata], sort_by: str, sort_order: str) -> list[FileMetadata]:
        reverse = sort_order == "desc"

        def item_key(item: FileMetadata):
            if sort_by == "type":
                return item.type.lower()
            if sort_by == "size":
                return item.size if item.size is not None else -1
            if sort_by == "modified_at":
                return item.modified_at or ""
            return item.name.lower()

        directories = [item for item in items if item.is_directory]
        files = [item for item in items if not item.is_directory]

        if sort_by == "size":
            directories.sort(key=lambda item: item.name.lower())
        else:
            directories.sort(key=item_key, reverse=reverse)

        files.sort(key=item_key, reverse=reverse)
        return directories + files

    def list_files(self, query: FileListQuery) -> list[FileMetadata]:
        relative_path = self._normalize_relative_path(query.path)
        root, target_dir = self._resolve_directory(relative_path)
        entries: list[FileMetadata] = []

        try:
            with os.scandir(target_dir) as directory_entries:
                for entry in directory_entries:
                    entry_path = Path(entry.path)
                    relative_entry_path = entry_path.relative_to(root).as_posix()
                    is_directory = entry.is_dir(follow_symlinks=False)
                    extension = None if is_directory else entry_path.suffix.lower() or None
                    entry_type = "Folder" if is_directory else self._file_type_from_extension(extension)
                    size = None if is_directory else entry.stat(follow_symlinks=False).st_size
                    modified_at = datetime.fromtimestamp(
                        entry.stat(follow_symlinks=False).st_mtime,
                        tz=UTC,
                    ).isoformat()

                    entries.append(
                        FileMetadata(
                            name=entry.name,
                            path=relative_entry_path,
                            is_directory=is_directory,
                            type=entry_type,
                            extension=extension,
                            size=size,
                            modified_at=modified_at,
                        )
                    )
        except PermissionError as exc:
            raise AppException(
                message="Permission denied for requested directory.",
                code="DIRECTORY_PERMISSION_DENIED",
                status_code=403,
            ) from exc
        except OSError as exc:
            raise AppException(
                message="Failed to read directory.",
                code="DIRECTORY_READ_ERROR",
                status_code=500,
            ) from exc

        if query.search:
            search_lower = query.search.strip().lower()
            entries = [e for e in entries if search_lower in e.name.lower()]

        return self._sort_file_items(entries, query.sort_by, query.sort_order)

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
