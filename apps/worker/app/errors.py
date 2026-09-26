"""Erros do worker. Todo erro vira `{ "error": WorkerErrorCode, "message": str }`.

A API (sdd-003) traduz os códigos para os códigos exibidos ao usuário; o `message` é só
para log e nunca deve ser mostrado na interface.
"""

from typing import Literal

WorkerErrorCode = Literal[
    "too_large",
    "invalid_audio",
    "too_long",
    "no_voice",
    "invalid_video_id",
    "video_unavailable",
    "download_failed",
    "invalid_lyrics",
    "invalid_query",
    "search_failed",
    "internal",
]

STATUS_BY_CODE: dict[str, int] = {
    "too_large": 413,
    "invalid_audio": 415,
    "too_long": 422,
    "no_voice": 422,
    "invalid_video_id": 400,
    "video_unavailable": 422,
    "download_failed": 502,
    "invalid_lyrics": 400,
    "invalid_query": 400,
    "search_failed": 502,
    "internal": 500,
}


class WorkerError(Exception):
    def __init__(self, code: WorkerErrorCode, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    @property
    def status_code(self) -> int:
        return STATUS_BY_CODE[self.code]
