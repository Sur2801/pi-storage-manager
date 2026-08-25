from fastapi import APIRouter, Depends, Query

from app.schemas.common import OperationResponse
from app.schemas.files import CopyRequest, DeleteRequest, FileListQuery, MoveRequest, RenameRequest, UploadRequest
from app.services.file_service import FileService
from app.services.storage_service import StorageService

router = APIRouter(prefix="/files", tags=["files"])


def get_file_service() -> FileService:
    return FileService(storage_service=StorageService())


@router.get("", response_model=OperationResponse)
def list_files(
    path: str = Query(default="/", min_length=1),
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    message = file_service.list_files(FileListQuery(path=path))
    return OperationResponse(message=message)


@router.post("/upload", response_model=OperationResponse)
def upload_file(
    request: UploadRequest,
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    message = file_service.upload_file(request)
    return OperationResponse(message=message)


@router.get("/download", response_model=OperationResponse)
def download_file(
    source_path: str = Query(min_length=1),
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    message = file_service.download_file(source_path)
    return OperationResponse(message=message)


@router.patch("/rename", response_model=OperationResponse)
def rename_file(
    request: RenameRequest,
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    message = file_service.rename_item(request)
    return OperationResponse(message=message)


@router.patch("/move", response_model=OperationResponse)
def move_file(
    request: MoveRequest,
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    message = file_service.move_item(request)
    return OperationResponse(message=message)


@router.post("/copy", response_model=OperationResponse)
def copy_file(
    request: CopyRequest,
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    message = file_service.copy_item(request)
    return OperationResponse(message=message)


@router.delete("", response_model=OperationResponse)
def delete_file(
    request: DeleteRequest,
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    message = file_service.delete_items(request)
    return OperationResponse(message=message)

