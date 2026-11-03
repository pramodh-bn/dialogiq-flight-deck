"""Safe public failures; never serialize provider or validation internals."""


class ApiError(Exception):
    def __init__(
        self, status: int, code: str, message: str, *, retryable: bool = False
    ) -> None:
        super().__init__(message)
        self.status = status
        self.detail = {"code": code, "message": message, "retryable": retryable}


def not_found(resource: str) -> ApiError:
    return ApiError(404, f"{resource}_not_found", f"{resource.capitalize()} not found.")


def conflict(code: str) -> ApiError:
    return ApiError(409, code, "Reload the session before retrying.")
