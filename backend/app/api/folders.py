from fastapi import APIRouter, Depends

from app.schemas.common import OperationResponse
from app.schemas.files import CreateFolderRequest
from app.services.file_service import FileService
from app.services.storage_service import StorageService

router = APIRouter(prefix="/folders", tags=["folders"])


def get_file_service() -> FileService:
    return FileService(storage_service=StorageService())


@router.post("", response_model=OperationResponse)
def create_folder(
    request: CreateFolderRequest,
    file_service: FileService = Depends(get_file_service),
) -> OperationResponse:
    return file_service.create_folder(request)
