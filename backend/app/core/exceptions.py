class AppException(Exception):
    def __init__(self, message: str, code: str = "APP_ERROR", status_code: int = 400) -> None:
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)
