from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError

from app.schemas.common import BulkOperationResponse, OperationResponse
from app.schemas.files import (
    CopyRequest,
    CreateFileRequest,
    DeleteRequest,
    DownloadResponse,
    FileListQuery,
    FileListResponse,
    MoveRequest,
    RenameRequest,
    UploadRequest,
    UploadResponse,
)
from app.services.file_service import FileService
from app.services.storage_service import StorageService

router = APIRouter(prefix="/files", tags=["files"])


def get_file_service() -> FileService:
    return FileService(storage_service=StorageService())


@router.get("", response_model=FileListResponse)
def list_files(
    path: str = Query(default="/", min_length=1, description="Path relative to STORAGE_ROOT"),
    search: str | None = Query(default=None, description="Optional search term"),
    sort_by: str = Query(default="name", pattern="^(name|type|size|modified_at)$"),
    sort_order: str = Query(default="asc", pattern="^(asc|desc)$"),
    file_service: FileService = Depends(get_file_service),
) -> FileListResponse:
    query = FileListQuery(path=path, search=search, sort_by=sort_by, sort_order=sort_order)
    return file_service.list_files(query)


@router.post("", response_model=OperationResponse)
def create_empty_file(
    request: CreateFileRequest,
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    return file_service.create_empty_file(request)


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    request: Request,
    file_service: FileService = Depends(get_file_service),
) -> UploadResponse:
    content_type = request.headers.get("content-type", "").lower()

    if "multipart/form-data" in content_type:
        form_data = await request.form()
        uploaded_file = form_data.get("uploaded_file")
        destination_path = str(form_data.get("destination_path") or "/")

        if uploaded_file is None or not hasattr(uploaded_file, "filename"):
            raise HTTPException(status_code=422, detail="uploaded_file is required for multipart upload.")

        return file_service.upload_file_multipart(
            destination_path=destination_path,
            file_name=str(getattr(uploaded_file, "filename", "") or "uploaded-file"),
            content_type=getattr(uploaded_file, "content_type", None),
        )

    try:
        json_payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid upload request payload.") from exc

    try:
        parsed_request = UploadRequest(**json_payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    return file_service.upload_file(parsed_request)


@router.get("/download", response_model=DownloadResponse)
def download_file(
    source_path: str = Query(min_length=1, description="Path relative to STORAGE_ROOT"),
    as_archive: bool = Query(default=False, description="Reserved for future multi-item archive downloads"),
    file_service: FileService = Depends(get_file_service),
) -> DownloadResponse:
    return file_service.download_file(source_path, as_archive)


@router.patch("/rename", response_model=OperationResponse)
def rename_file(
    request: RenameRequest,
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    return file_service.rename_item(request)


@router.patch("/move", response_model=BulkOperationResponse)
def move_file(
    request: MoveRequest,
    file_service: FileService = Depends(get_file_service),
) -> BulkOperationResponse:
    return file_service.move_item(request)


@router.post("/copy", response_model=BulkOperationResponse)
def copy_file(
    request: CopyRequest,
    file_service: FileService = Depends(get_file_service),
) -> BulkOperationResponse:
    return file_service.copy_item(request)


@router.delete("", response_model=BulkOperationResponse)
def delete_file(
    request: DeleteRequest,
    file_service: FileService = Depends(get_file_service),
) -> BulkOperationResponse:
    return file_service.delete_items(request)
