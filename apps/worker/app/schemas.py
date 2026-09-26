from typing import Literal

from pydantic import BaseModel

from app.errors import WorkerErrorCode


class PitchTrack(BaseModel):
    """Curva de pitch: 1 valor a cada 10 ms, nota MIDI fracionária (69.00 = A4 440 Hz).

    `None` = sem voz naquele frame. Mesmo formato para a referência e para a voz cantada
    (contrato compartilhado com apps/api e apps/web).
    """

    version: Literal[1] = 1
    hopMs: Literal[10] = 10
    durationMs: int
    midi: list[float | None]


class YoutubeRequest(BaseModel):
    # Sem padrão aqui de propósito: o videoId é validado à mão para responder
    # 400 invalid_video_id (e não o 422 genérico do FastAPI).
    videoId: str
    separate: bool = True


class YoutubeAudioRequest(BaseModel):
    videoId: str


class ErrorResponse(BaseModel):
    error: WorkerErrorCode
    message: str
