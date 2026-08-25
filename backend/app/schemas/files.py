from pydantic import BaseModel, Field


class FileListQuery(BaseModel):
    path: str = Field(default="/", min_length=1)


class UploadRequest(BaseModel):
    destination_path: str = Field(default="/", min_length=1)
    item_name: str = Field(min_length=1)


class CreateFolderRequest(BaseModel):
    parent_path: str = Field(default="/", min_length=1)
    folder_name: str = Field(min_length=1)


class RenameRequest(BaseModel):
    source_path: str = Field(min_length=1)
    new_name: str = Field(min_length=1)


class MoveRequest(BaseModel):
    source_path: str = Field(min_length=1)
    destination_path: str = Field(min_length=1)


class CopyRequest(BaseModel):
    source_path: str = Field(min_length=1)
    destination_path: str = Field(min_length=1)


class DeleteRequest(BaseModel):
    target_paths: list[str] = Field(min_length=1)

