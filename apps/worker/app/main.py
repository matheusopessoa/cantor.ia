"""cantor.ia worker: extrai a curva de pitch da voz (arquivo enviado ou vídeo do YouTube).

Stateless: o áudio só existe num diretório temporário da requisição e é apagado ao final.
"""

import asyncio
import shutil
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from app import audio, pitch, separation, youtube
from app.errors import WorkerError
from app.schemas import ErrorResponse, PitchTrack, YoutubeAudioRequest, YoutubeRequest

DOWNLOAD_TIMEOUT_S = 120
UPLOAD_CHUNK = 1024 * 1024

# Documenta no OpenAPI o corpo de erro { error, message } de todas as rotas.
ERROR_RESPONSES = {status: {"model": ErrorResponse} for status in (400, 413, 415, 422, 500, 502)}

# Uma extração (Demucs + crepe) por vez: dois Demucs em paralelo na CPU estouram a RAM.
# Downloads do YouTube ficam FORA do semáforo.
_extraction_lock = asyncio.Semaphore(1)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await run_in_threadpool(separation.load)
    await run_in_threadpool(pitch.load)
    yield


app = FastAPI(title="cantor.ia worker", version="0.1.0", lifespan=lifespan)


# ── Erros: sempre { error: WorkerErrorCode, message } ─────────────────


def _error(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


@app.exception_handler(WorkerError)
async def worker_error_handler(_: Request, exc: WorkerError) -> JSONResponse:
    return _error(exc.code, exc.message, exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Corpo malformado: nas rotas do YouTube é um videoId ausente/inválido; no /extract,
    # um arquivo ausente.
    if request.url.path.startswith("/youtube"):
        return _error("invalid_video_id", "corpo precisa ter videoId", 400)
    return _error("invalid_audio", "envie o arquivo no campo 'file'", 415)


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, exc: Exception) -> JSONResponse:
    return _error("internal", f"erro inesperado: {type(exc).__name__}", 500)


# ── Pipeline ──────────────────────────────────────────────────────────


def _new_tmp_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="cantor-worker-"))


def _cleanup(tmp_dir: Path) -> None:
    shutil.rmtree(tmp_dir, ignore_errors=True)


def _extract_sync(path: Path, separate: bool) -> PitchTrack:
    audio.ensure_max_duration(path)
    wav = audio.decode(path)
    mono = separation.vocals(wav) if separate else wav.mean(axis=0)
    midi = pitch.track(mono)
    if all(value is None for value in midi):
        raise WorkerError("no_voice", "nenhum frame com voz")
    return PitchTrack(durationMs=audio.duration_ms(wav), midi=midi)


async def _extract(path: Path, separate: bool) -> PitchTrack:
    async with _extraction_lock:
        return await run_in_threadpool(_extract_sync, path, separate)


async def _save_upload(file: UploadFile, tmp_dir: Path) -> Path:
    suffix = Path(file.filename or "audio").suffix[:10]
    dest = tmp_dir / f"upload{suffix}"
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(UPLOAD_CHUNK):
            size += len(chunk)
            if size > audio.MAX_FILE_BYTES:
                raise WorkerError("too_large", "arquivo maior que 20 MB")
            out.write(chunk)
    if size == 0:
        raise WorkerError("invalid_audio", "arquivo vazio")
    return dest


async def _download(video_id: str, tmp_dir: Path) -> Path:
    cancel = threading.Event()
    loop = asyncio.get_running_loop()
    future = loop.run_in_executor(None, youtube.download_audio, video_id, tmp_dir, cancel)
    try:
        # shield: o timeout não "cancela" a thread (isso é impossível); quem para o yt-dlp é
        # o `cancel`, e a limpeza final roda só quando a thread terminar de verdade.
        return await asyncio.wait_for(asyncio.shield(future), timeout=DOWNLOAD_TIMEOUT_S)
    except TimeoutError as exc:
        cancel.set()

        def cleanup_when_thread_ends(done: asyncio.Future) -> None:
            if not done.cancelled():
                done.exception()   # marca a exceção da thread como tratada
            _cleanup(tmp_dir)

        future.add_done_callback(cleanup_when_thread_ends)
        raise WorkerError("download_failed", "download do YouTube passou do tempo limite") from exc


# ── Rotas ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "models": {"demucs": separation.is_loaded(), "crepe": pitch.is_loaded()},
    }


@app.post("/extract", response_model=PitchTrack, responses=ERROR_RESPONSES)
async def extract(file: UploadFile = File(...), separate: bool = Form(True)) -> PitchTrack:
    tmp_dir = _new_tmp_dir()
    try:
        path = await _save_upload(file, tmp_dir)
        return await _extract(path, separate)
    finally:
        _cleanup(tmp_dir)


@app.post("/youtube/extract", response_model=PitchTrack, responses=ERROR_RESPONSES)
async def youtube_extract(body: YoutubeRequest) -> PitchTrack:
    youtube.validate_video_id(body.videoId)
    tmp_dir = _new_tmp_dir()
    try:
        path = await _download(body.videoId, tmp_dir)   # fora do semáforo
        return await _extract(path, body.separate)
    finally:
        _cleanup(tmp_dir)


@app.post("/youtube/audio", responses={200: {"content": {"audio/mp4": {}, "audio/mpeg": {}}}, **ERROR_RESPONSES})
async def youtube_audio(body: YoutubeAudioRequest) -> FileResponse:
    youtube.validate_video_id(body.videoId)
    tmp_dir = _new_tmp_dir()
    try:
        path = await _download(body.videoId, tmp_dir)
        if path.suffix == ".m4a":
            media_type = "audio/mp4"
        else:
            # Opus/WebM não é garantido no Safari: converte para MP3
            mp3 = tmp_dir / "audio-converted.mp3"
            await run_in_threadpool(audio.to_mp3, path, mp3)
            path, media_type = mp3, "audio/mpeg"
    except BaseException:
        _cleanup(tmp_dir)
        raise
    # O arquivo precisa existir até o último byte ser enviado: a limpeza roda DEPOIS.
    return FileResponse(path, media_type=media_type, background=BackgroundTask(_cleanup, tmp_dir))
