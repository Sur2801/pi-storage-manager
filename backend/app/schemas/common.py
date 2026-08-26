from pydantic import BaseModel


class OperationResponse(BaseModel):
    success: bool = True
    message: str

