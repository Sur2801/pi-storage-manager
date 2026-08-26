class StorageService:
    def list_files(self, _: str) -> str:
        return "File listing endpoint is working"

    def upload_file(self, _: str, __: str) -> str:
        return "File upload endpoint is working"

    def download_file(self, _: str) -> str:
        return "File download endpoint is working"

    def create_folder(self, _: str, __: str) -> str:
        return "Folder creation endpoint is working"

    def rename_item(self, _: str, __: str) -> str:
        return "File rename endpoint is working"

    def move_item(self, _: str, __: str) -> str:
        return "File move endpoint is working"

    def copy_item(self, _: str, __: str) -> str:
        return "File copy endpoint is working"

    def delete_items(self, _: list[str]) -> str:
        return "File delete endpoint is working"

