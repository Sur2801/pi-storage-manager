from pydantic import BaseModel, Field


class OperationResponse(BaseModel):
    success: bool = True
    message: str


class BulkOperationItemResult(BaseModel):
    path: str
    success: bool
    error: str | None = None


class BulkOperationResponse(OperationResponse):
    results: list[BulkOperationItemResult] = Field(default_factory=list)
