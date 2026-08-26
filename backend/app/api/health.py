from fastapi import APIRouter

from app.schemas.common import OperationResponse

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=OperationResponse)
def health_check() -> OperationResponse:
    return OperationResponse(message="Health endpoint is working")

