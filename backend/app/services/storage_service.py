from __future__ import annotations

import errno
import functools
import mimetypes
import os
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import BinaryIO
from urllib.parse import unquote

from app.core.config import settings
from app.core.exceptions import AppException
from app.schemas.common import BulkOperationItemResult
from app.schemas.files import FileListQuery, FileMetadata


SYSTEM_METADATA_NAMES = {
    "$RECYCLE.BIN",
    ".DS_Store",
    ".dropbox.device",
    ".fseventsd",
    ".Spotlight-V100",
    ".TemporaryItems",
    ".Trashes",
    "desktop.ini",
    "thumbs.db",
}


@dataclass
class DownloadPreparation:
    file_path: Path
    download_name: str
    cleanup_path: Path | None = None


@dataclass
class PreviewPreparation:
    file_path: Path
    media_type: str
    file_name: str


class StorageService:
    _UPLOAD_CHUNK_SIZE = 1024 * 1024
    _INVALID_NAME_CHARS = set('<>:"/\\|?*')
    _WINDOWS_RESERVED_NAMES = {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "COM1",
        "COM2",
        "COM3",
        "COM4",
        "COM5",
        "COM6",
        "COM7",
        "COM8",
        "COM9",
        "LPT1",
        "LPT2",
        "LPT3",
        "LPT4",
        "LPT5",
        "LPT6",
        "LPT7",
        "LPT8",
        "LPT9",
    }

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

        candidate = raw_path.strip()
        for _ in range(3):
            decoded_candidate = unquote(candidate)
            if decoded_candidate == candidate:
                break
            candidate = decoded_candidate

        candidate = candidate.replace("\\", "/")
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
        normalized_parts: list[str] = []
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

    def _validate_item_name(self, raw_name: str, *, label: str = "Name") -> str:
        name = raw_name.strip()
        if not name:
            raise AppException(
                message=f"{label} cannot be empty.",
                code="EMPTY_NAME",
                status_code=400,
            )
        if name in {".", ".."}:
            raise AppException(
                message=f"Invalid {label.lower()}.",
                code="INVALID_NAME",
                status_code=400,
            )
        if "/" in name or "\\" in name:
            raise AppException(
                message=f"{label} must not contain path separators.",
                code="INVALID_NAME",
                status_code=400,
            )
        if any(character in self._INVALID_NAME_CHARS for character in name):
            raise AppException(
                message=f"Invalid {label.lower()}.",
                code="INVALID_NAME",
                status_code=400,
            )
        if any(ord(character) < 32 for character in name):
            raise AppException(
                message=f"Invalid {label.lower()}.",
                code="INVALID_NAME",
                status_code=400,
            )
        if name.endswith((" ", ".")):
            raise AppException(
                message=f"Invalid {label.lower()}.",
                code="INVALID_NAME",
                status_code=400,
            )
        if name.split(".")[0].upper() in self._WINDOWS_RESERVED_NAMES:
            raise AppException(
                message=f"Invalid {label.lower()}.",
                code="INVALID_NAME",
                status_code=400,
            )
        return name

    def _validate_relative_parts(self, relative_path: str, *, label: str = "Path") -> str:
        normalized = self._normalize_relative_path(relative_path)
        if not normalized:
            raise AppException(
                message=f"{label} cannot be empty.",
                code="EMPTY_PATH",
                status_code=400,
            )

        validated_parts = [
            self._validate_item_name(part, label=label)
            for part in PurePosixPath(normalized).parts
        ]
        return "/".join(validated_parts)

    @staticmethod
    def _ensure_within_root(root: Path, target: Path) -> None:
        if root != target and root not in target.parents:
            raise AppException(
                message="Requested path is outside storage root.",
                code="PATH_OUTSIDE_STORAGE_ROOT",
                status_code=403,
            )

    def _resolve_existing_path(
        self,
        relative_path: str,
        *,
        expected_type: str | None = None,
        allow_root: bool = True,
    ) -> tuple[Path, Path, str]:
        normalized = self._normalize_relative_path(relative_path)
        root = self._storage_root()
        candidate = root if normalized == "" else root / Path(normalized)

        try:
            target = candidate.resolve(strict=True)
        except FileNotFoundError as exc:
            raise AppException(
                message="Requested item was not found.",
                code="ITEM_NOT_FOUND",
                status_code=404,
            ) from exc

        self._ensure_within_root(root, target)
        if not allow_root and target == root:
            raise AppException(
                message="Storage root cannot be modified.",
                code="ROOT_OPERATION_BLOCKED",
                status_code=400,
            )
        if expected_type == "directory" and not target.is_dir():
            raise AppException(
                message="Requested path is not a directory.",
                code="INVALID_DIRECTORY_PATH",
                status_code=400,
            )
        if expected_type == "file" and not target.is_file():
            raise AppException(
                message="Requested path is not a file.",
                code="INVALID_FILE_PATH",
                status_code=400,
            )
        return root, target, normalized

    def _resolve_directory(self, relative_path: str) -> tuple[Path, Path]:
        root, target, _ = self._resolve_existing_path(relative_path, expected_type="directory")
        return root, target

    def _resolve_destination_path(self, parent_relative_path: str, item_name: str) -> tuple[Path, Path, Path, str]:
        root, parent_dir, normalized_parent = self._resolve_existing_path(
            parent_relative_path,
            expected_type="directory",
        )
        validated_name = self._validate_item_name(item_name)
        target_path = parent_dir / validated_name
        self._ensure_within_root(root, parent_dir.resolve())
        return root, parent_dir, target_path, normalized_parent

    def _relative_path(self, root: Path, path: Path) -> str:
        return path.relative_to(root).as_posix()

    def _map_filesystem_error(
        self,
        exc: OSError,
        *,
        default_message: str,
        default_code: str,
        default_status: int = 500,
    ) -> AppException:
        if isinstance(exc, PermissionError):
            return AppException(
                message="Permission denied.",
                code="PERMISSION_DENIED",
                status_code=403,
            )
        if exc.errno in {errno.ENOSPC, getattr(errno, "EDQUOT", errno.ENOSPC)}:
            return AppException(
                message="Insufficient storage space.",
                code="INSUFFICIENT_STORAGE",
                status_code=507,
            )
        if exc.errno in {errno.EEXIST, errno.ENOTEMPTY}:
            return AppException(
                message="File already exists.",
                code="ITEM_ALREADY_EXISTS",
                status_code=409,
            )
        return AppException(
            message=default_message,
            code=default_code,
            status_code=default_status,
        )

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

    def _to_file_metadata(self, root: Path, entry_path: Path, *, is_directory: bool) -> FileMetadata:
        stat_result = entry_path.stat(follow_symlinks=False)
        extension = None if is_directory else entry_path.suffix.lower() or None
        entry_type = "Folder" if is_directory else self._file_type_from_extension(extension)

        return FileMetadata(
            name=entry_path.name,
            path=self._relative_path(root, entry_path),
            is_directory=is_directory,
            type=entry_type,
            extension=extension,
            size=None if is_directory else stat_result.st_size,
            modified_at=datetime.fromtimestamp(stat_result.st_mtime, tz=UTC).isoformat(),
        )

    @staticmethod
    def _is_system_metadata_name(name: str) -> bool:
        lower_name = name.lower()
        if name in SYSTEM_METADATA_NAMES or lower_name in SYSTEM_METADATA_NAMES:
            return True
        return (
            lower_name.startswith("._")
            or lower_name.startswith(".volumeicon.")
            or lower_name == "thumbs.db"
        )

    def _should_include_entry(self, entry: os.DirEntry[str], include_hidden: bool) -> bool:
        if include_hidden:
            return True
        return not self._is_system_metadata_name(entry.name)

    def _sort_file_items(self, items: list[FileMetadata], sort_by: str, sort_order: str) -> list[FileMetadata]:
        """Sort items by the requested column, with folders and files interleaved.

        Directories have no size; when sorting by size they are treated as
        infinitely large (appear last in ascending order, first in descending).
        Tie-breaking is always by name ascending for deterministic output.
        """
        reverse = sort_order == "desc"

        def primary_key(item: FileMetadata):
            if sort_by == "type":
                return item.type.lower()
            if sort_by == "size":
                # None (directory) → infinity so they sort after all files asc / before all files desc
                return float(item.size) if item.size is not None else float("inf")
            if sort_by == "modified_at":
                return item.modified_at or ""
            return item.name.lower()  # default: name

        def compare(a: FileMetadata, b: FileMetadata) -> int:
            pk_a = primary_key(a)
            pk_b = primary_key(b)
            if pk_a < pk_b:
                cmp = -1
            elif pk_a > pk_b:
                cmp = 1
            else:
                cmp = 0
            if reverse:
                cmp = -cmp
            if cmp == 0:
                # Tiebreak: name always ascending, regardless of primary direction
                na = a.name.lower()
                nb = b.name.lower()
                cmp = -1 if na < nb else (1 if na > nb else 0)
            return cmp

        result = list(items)
        result.sort(key=functools.cmp_to_key(compare))
        return result

    def _block_descendant_destination(self, source_path: Path, destination_dir: Path) -> None:
        if source_path.is_dir() and (destination_dir == source_path or source_path in destination_dir.parents):
            raise AppException(
                message="A folder cannot be moved or copied into itself or its descendants.",
                code="INVALID_DESTINATION",
                status_code=400,
            )

    def list_files(self, query: FileListQuery) -> tuple[list[FileMetadata], int]:
        relative_path = self._normalize_relative_path(query.path)
        root, target_dir = self._resolve_directory(relative_path)
        entries: list[FileMetadata] = []

        try:
            with os.scandir(target_dir) as directory_entries:
                for entry in directory_entries:
                    if not self._should_include_entry(entry, query.include_hidden):
                        continue
                    entry_path = Path(entry.path)
                    is_directory = entry.is_dir(follow_symlinks=False)
                    entries.append(self._to_file_metadata(root, entry_path, is_directory=is_directory))
        except PermissionError as exc:
            raise AppException(
                message="Permission denied for requested directory.",
                code="DIRECTORY_PERMISSION_DENIED",
                status_code=403,
            ) from exc
        except OSError as exc:
            raise self._map_filesystem_error(
                exc,
                default_message="Failed to read directory.",
                default_code="DIRECTORY_READ_ERROR",
            ) from exc

        if query.search:
            search_lower = query.search.strip().lower()
            entries = [entry for entry in entries if search_lower in entry.name.lower()]

        sorted_entries = self._sort_file_items(entries, query.sort_by, query.sort_order)
        total_items = len(sorted_entries)
        paged_entries = sorted_entries[query.offset : query.offset + query.limit]
        return paged_entries, total_items

    def create_empty_file(self, _: str, __: str) -> str:
        return "Create empty file endpoint is working"

    def upload_file(self, _: str, __: str) -> str:
        return "File upload endpoint is working"

    def upload_file_stream(
        self,
        destination_path: str,
        file_name: str,
        file_stream: BinaryIO,
        relative_file_path: str | None = None,
    ) -> str:
        root, destination_dir = self._resolve_directory(self._normalize_relative_path(destination_path))
        if relative_file_path:
            validated_relative_path = self._validate_relative_parts(relative_file_path, label="Relative upload path")
            relative_parts = list(PurePosixPath(validated_relative_path).parts)
            validated_name = relative_parts[-1]
            parent_parts = relative_parts[:-1]
            final_parent = destination_dir.joinpath(*parent_parts) if parent_parts else destination_dir
        else:
            validated_name = self._validate_item_name(file_name, label="File name")
            final_parent = destination_dir

        final_path = final_parent / validated_name
        self._ensure_within_root(root, final_path)

        if final_path.exists():
            raise AppException(
                message="File already exists.",
                code="ITEM_ALREADY_EXISTS",
                status_code=409,
            )

        temp_path: Path | None = None
        try:
            final_parent.mkdir(parents=True, exist_ok=True)
            file_stream.seek(0)
            with tempfile.NamedTemporaryFile(
                mode="wb",
                delete=False,
                dir=final_parent,
                prefix=".upload-",
                suffix=".part",
            ) as temp_file:
                temp_path = Path(temp_file.name)
                while True:
                    chunk = file_stream.read(self._UPLOAD_CHUNK_SIZE)
                    if not chunk:
                        break
                    temp_file.write(chunk)
                temp_file.flush()
                os.fsync(temp_file.fileno())

            if final_path.exists():
                raise AppException(
                    message="File already exists.",
                    code="ITEM_ALREADY_EXISTS",
                    status_code=409,
                )

            temp_path.rename(final_path)
        except AppException:
            if temp_path and temp_path.exists():
                temp_path.unlink(missing_ok=True)
            raise
        except OSError as exc:
            if temp_path and temp_path.exists():
                temp_path.unlink(missing_ok=True)
            raise self._map_filesystem_error(
                exc,
                default_message="Unable to upload file.",
                default_code="UPLOAD_FAILED",
            ) from exc

        return "Upload completed."

    def prepare_preview(self, source_path: str) -> PreviewPreparation:
        _, target_path, _ = self._resolve_existing_path(source_path, expected_type="file", allow_root=False)
        media_type, _ = mimetypes.guess_type(target_path.name)
        return PreviewPreparation(
            file_path=target_path,
            media_type=media_type or "application/octet-stream",
            file_name=target_path.name,
        )

    def _add_path_to_archive(self, archive: zipfile.ZipFile, source_path: Path) -> None:
        if source_path.is_dir():
            has_entries = False
            for child in source_path.rglob("*"):
                if child.is_dir():
                    continue
                has_entries = True
                archive.write(child, arcname=Path(source_path.name) / child.relative_to(source_path))
            if not has_entries:
                archive.writestr(f"{source_path.name}/", "")
            return

        archive.write(source_path, arcname=source_path.name)

    def prepare_download(
        self,
        source_path: str | None = None,
        source_paths: list[str] | None = None,
        as_archive: bool = False,
    ) -> DownloadPreparation:
        normalized_sources: list[str] = []
        if source_path:
            normalized_sources.append(self._normalize_relative_path(source_path))
        if source_paths:
            normalized_sources.extend(self._normalize_relative_path(path) for path in source_paths)

        unique_sources = list(dict.fromkeys(normalized_sources))
        if not unique_sources:
            raise AppException(
                message="Provide source_path or source_paths.",
                code="MISSING_DOWNLOAD_SOURCE",
                status_code=400,
            )

        resolved_items = [
            self._resolve_existing_path(normalized_source, allow_root=False)
            for normalized_source in unique_sources
        ]

        if len(resolved_items) == 1 and resolved_items[0][1].is_file() and not as_archive:
            _, target_path, _ = resolved_items[0]
            return DownloadPreparation(
                file_path=target_path,
                download_name=target_path.name,
            )

        if len(resolved_items) > 1 or any(item[1].is_dir() for item in resolved_items) or as_archive:
            archive_file = tempfile.NamedTemporaryFile(
                prefix="pi-storage-manager-",
                suffix=".zip",
                delete=False,
            )
            archive_path = Path(archive_file.name)
            archive_file.close()
            try:
                with zipfile.ZipFile(archive_path, mode="w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                    for _, resolved_path, _ in resolved_items:
                        self._add_path_to_archive(archive, resolved_path)
            except OSError as exc:
                archive_path.unlink(missing_ok=True)
                raise self._map_filesystem_error(
                    exc,
                    default_message="Unable to prepare download.",
                    default_code="DOWNLOAD_PREPARATION_FAILED",
                ) from exc

            archive_name = (
                f"{resolved_items[0][1].name}.zip"
                if len(resolved_items) == 1
                else "pi-storage-manager-download.zip"
            )
            return DownloadPreparation(
                file_path=archive_path,
                download_name=archive_name,
                cleanup_path=archive_path,
            )

        raise AppException(
            message="Requested path cannot be downloaded.",
            code="INVALID_DOWNLOAD_PATH",
            status_code=400,
        )

    def create_folder(self, parent_path: str, folder_name: str) -> str:
        _, parent_dir = self._resolve_directory(self._normalize_relative_path(parent_path))
        validated_name = self._validate_item_name(folder_name, label="Folder name")
        target_path = parent_dir / validated_name
        if target_path.exists():
            raise AppException(
                message="File already exists.",
                code="ITEM_ALREADY_EXISTS",
                status_code=409,
            )
        try:
            target_path.mkdir()
        except OSError as exc:
            raise self._map_filesystem_error(
                exc,
                default_message="Unable to create folder.",
                default_code="CREATE_FOLDER_FAILED",
            ) from exc
        return "Folder created."

    def rename_item(self, source_path: str, new_name: str) -> str:
        root, current_path, _ = self._resolve_existing_path(source_path, allow_root=False)
        validated_name = self._validate_item_name(new_name)
        destination_path = current_path.parent / validated_name
        self._ensure_within_root(root, destination_path)

        if current_path.name == validated_name:
            return "Item name unchanged."
        if destination_path.exists():
            raise AppException(
                message="File already exists.",
                code="ITEM_ALREADY_EXISTS",
                status_code=409,
            )

        try:
            current_path.rename(destination_path)
        except OSError as exc:
            raise self._map_filesystem_error(
                exc,
                default_message="Unable to rename item.",
                default_code="RENAME_FAILED",
            ) from exc
        return "Item renamed."

    def move_items(self, source_paths: list[str], destination_path: str) -> list[BulkOperationItemResult]:
        normalized_sources = [self._normalize_relative_path(path) for path in source_paths]
        root, destination_dir, _ = self._resolve_existing_path(destination_path, expected_type="directory")
        results: list[BulkOperationItemResult] = []

        for normalized_source in normalized_sources:
            try:
                _, source_item, _ = self._resolve_existing_path(normalized_source, allow_root=False)
                self._block_descendant_destination(source_item, destination_dir)
                target_path = destination_dir / source_item.name
                self._ensure_within_root(root, target_path)

                if source_item == target_path:
                    raise AppException(
                        message="Source and destination are the same.",
                        code="SAME_SOURCE_DESTINATION",
                        status_code=400,
                    )
                if target_path.exists():
                    raise AppException(
                        message="File already exists.",
                        code="ITEM_ALREADY_EXISTS",
                        status_code=409,
                    )

                shutil.move(str(source_item), str(target_path))
                results.append(BulkOperationItemResult(path=normalized_source, success=True))
            except AppException as exc:
                results.append(BulkOperationItemResult(path=normalized_source, success=False, error=exc.message))
            except OSError as exc:
                results.append(
                    BulkOperationItemResult(
                        path=normalized_source,
                        success=False,
                        error=self._map_filesystem_error(
                            exc,
                            default_message="Unable to move item.",
                            default_code="MOVE_FAILED",
                        ).message,
                    )
                )

        return results

    def copy_items(self, source_paths: list[str], destination_path: str) -> list[BulkOperationItemResult]:
        normalized_sources = [self._normalize_relative_path(path) for path in source_paths]
        root, destination_dir, _ = self._resolve_existing_path(destination_path, expected_type="directory")
        results: list[BulkOperationItemResult] = []

        for normalized_source in normalized_sources:
            try:
                _, source_item, _ = self._resolve_existing_path(normalized_source, allow_root=False)
                self._block_descendant_destination(source_item, destination_dir)
                target_path = destination_dir / source_item.name
                self._ensure_within_root(root, target_path)

                if target_path.exists():
                    raise AppException(
                        message="File already exists.",
                        code="ITEM_ALREADY_EXISTS",
                        status_code=409,
                    )

                if source_item.is_dir():
                    shutil.copytree(source_item, target_path, copy_function=shutil.copy2)
                else:
                    shutil.copy2(source_item, target_path)
                results.append(BulkOperationItemResult(path=normalized_source, success=True))
            except AppException as exc:
                results.append(BulkOperationItemResult(path=normalized_source, success=False, error=exc.message))
            except OSError as exc:
                results.append(
                    BulkOperationItemResult(
                        path=normalized_source,
                        success=False,
                        error=self._map_filesystem_error(
                            exc,
                            default_message="Unable to copy item.",
                            default_code="COPY_FAILED",
                        ).message,
                    )
                )

        return results

    def delete_items(self, target_paths: list[str]) -> list[BulkOperationItemResult]:
        normalized_targets = [self._normalize_relative_path(path) for path in target_paths]
        results: list[BulkOperationItemResult] = []

        for normalized_target in normalized_targets:
            try:
                _, target_item, _ = self._resolve_existing_path(normalized_target, allow_root=False)
                if target_item.is_dir():
                    shutil.rmtree(target_item)
                else:
                    target_item.unlink()
                results.append(BulkOperationItemResult(path=normalized_target, success=True))
            except AppException as exc:
                results.append(BulkOperationItemResult(path=normalized_target, success=False, error=exc.message))
            except OSError as exc:
                results.append(
                    BulkOperationItemResult(
                        path=normalized_target,
                        success=False,
                        error=self._map_filesystem_error(
                            exc,
                            default_message="Unable to delete item.",
                            default_code="DELETE_FAILED",
                        ).message,
                    )
                )

        return results
