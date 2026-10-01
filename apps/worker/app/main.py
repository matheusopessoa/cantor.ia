"""cantor.ia worker: extrai a curva de pitch da voz (arquivo enviado ou vídeo do YouTube),
alinha a letra (sdd-010) ou escolhe a letra entre as candidatas com a transcrição da voz
(sdd-011), separa a música em voz e instrumental (sdd-013), e busca no YouTube e no YouTube
Music.

Stateless: o áudio só existe num diretório temporário da requisição e é apagado ao final.
"""

import asyncio
import functools
import logging
import shutil
import tempfile
import threading
import uuid
from collections.abc import Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from pydantic import TypeAdapter, ValidationError

from app import alignment, audio, device, lyrics_selection, pitch, separation, transcription, youtube, ytmusic
from app.errors import WorkerError
from app.schemas import (
    AlignRequest,
    AlignResponse,
    ErrorResponse,
    ExtractResponse,
    LyricsCandidate,
    LyricsLine,
    SelectedLyrics,
    TranscriptWord,
    YoutubeAudioRequest,
    YoutubeCandidate,
    YoutubeRequest,
    YoutubeSearchRequest,
    YoutubeSearchResponse,
    YtmusicSearchRequest,
    YtmusicSearchResponse,
    YtmusicSong,
    YtmusicSongRequest,
)

DOWNLOAD_TIMEOUT_S = 120
SEARCH_TIMEOUT_S = 20
# Busca no YouTube Music: 1 requisição + 2 por música para a letra (em paralelo).
YTMUSIC_TIMEOUT_S = 30
UPLOAD_CHUNK = 1024 * 1024

# Documenta no OpenAPI o corpo de erro { error, message } de todas as rotas.
ERROR_RESPONSES = {status: {"model": ErrorResponse} for status in (400, 413, 415, 422, 500, 502)}

# Uma extração (Demucs + crepe + alinhador da letra) por vez: dois Demucs em paralelo na CPU
# estouram a RAM. A separação em trilhas (sdd-013) entra no mesmo semáforo. Downloads e buscas
# no YouTube ficam FORA dele.
_extraction_lock = asyncio.Semaphore(1)

log = logging.getLogger(__name__)

_lyrics_adapter = TypeAdapter(list[LyricsLine])
_candidates_adapter = TypeAdapter(list[LyricsCandidate])


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Primeiro o device (sdd-016): `WORKER_DEVICE=mps` sem MPS derruba o boot aqui, com a
    # mensagem clara, antes de qualquer peso ser carregado.
    device.resolve()
    await run_in_threadpool(separation.load)
    await run_in_threadpool(pitch.load)
    await run_in_threadpool(alignment.load)
    # Com a OpenAI (sdd-014) o Whisper local é só reserva: carrega na primeira vez que for usado,
    # sem ocupar ~1,6 GB de RAM no boot.
    if transcription.provider() == "local":
        await run_in_threadpool(transcription.load)
    yield


app = FastAPI(title="cantor.ia worker", version="0.7.0", lifespan=lifespan)


# ── Erros: sempre { error: WorkerErrorCode, message } ─────────────────


def _error(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


@app.exception_handler(WorkerError)
async def worker_error_handler(_: Request, exc: WorkerError) -> JSONResponse:
    return _error(exc.code, exc.message, exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Corpo malformado: `lyrics` fora do formato (bug da API, sdd-010; `current`/`proposed` no
    # /youtube/align, sdd-012); na busca, a query ausente; nas outras rotas do YouTube, um
    # videoId ausente/inválido; no /extract e no /stems, um arquivo ausente.
    lyrics_fields = {"lyrics", "lyricsCandidates", "current", "proposed"}
    if any(lyrics_fields & set(error.get("loc", ())) for error in exc.errors()):
        return _error("invalid_lyrics", "lyrics precisa ser uma lista de { text, startMs? }", 400)
    if request.url.path in ("/youtube/search", "/ytmusic/search"):
        return _error("invalid_query", "corpo precisa ter query", 400)
    if request.url.path.startswith(("/youtube", "/ytmusic")):
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


@dataclass(frozen=True)
class LyricsInput:
    """A letra do pedido: conhecida (`lyrics`, sdd-010) ou a escolher entre candidatas
    (`candidates`, sdd-011; lista vazia = só a transcrição). Nunca as duas."""

    lyrics: list[LyricsLine] | None = None
    candidates: list[LyricsCandidate] | None = None
    prompt: str | None = None


def _check_lyrics_input(lyrics: list[LyricsLine] | None, candidates: list[LyricsCandidate] | None) -> None:
    if lyrics is not None and candidates is not None:
        raise WorkerError("invalid_lyrics", "envie lyrics ou lyricsCandidates, não os dois")


def _select_lyrics(
    mono, candidates: list[LyricsCandidate], prompt: str | None, duration_ms: int, tmp_dir: Path | None = None
) -> tuple[SelectedLyrics, list[TranscriptWord]]:
    """Transcreve a voz e escolhe a letra (sdd-011). Whisper que falha não derruba a extração:
    sem transcrição, fica a primeira candidata (mesma política do alinhador na sdd-010). A
    transcrição pela OpenAI já cai sozinha no Whisper local (sdd-014); esta política vale quando
    os dois falham. Devolve também as palavras transcritas, que a API guarda para a revisão
    (sdd-012). `tmp_dir`: o da requisição, onde fica o MP3 enviado à OpenAI."""
    # A língua vem da letra dos sites: sem ela, o Whisper adivinha pelo começo do áudio e às vezes
    # transcreve na língua errada. Sem candidatas (ou língua ambígua), ele continua adivinhando.
    language = lyrics_selection.guess_language(candidates)
    try:
        transcript = transcription.transcribe(mono, prompt, tmp_dir, language=language)
    except Exception:  # noqa: BLE001 — degradação controlada
        log.exception("transcrição falhou; a escolha da letra segue sem ela")
        transcript = transcription.Transcript(words=[], language=None)
    words = [TranscriptWord(text=w.text, startMs=w.startMs, endMs=w.endMs, probability=w.probability) for w in transcript.words]
    return lyrics_selection.choose(candidates, transcript, duration_ms), words


StemPaths = tuple[Path, Path]


def _extract_sync(
    path: Path, separate: bool, lyrics: LyricsInput | None = None, stems: bool = False
) -> tuple[ExtractResponse, StemPaths | None]:
    """A extração. Com `stems` e `separate` (sdd-016), o Demucs roda UMA vez (`separation.stems`):
    a voz mono do crepe, do Whisper e do MMS_FA é a média do mesmo stem `vocals` que vira a
    trilha de voz, e o instrumental é `mix − voz`. As duas trilhas são gravadas em AAC no tmp da
    requisição (`path.parent`) só depois de a curva existir: um `no_voice` não codifica nada."""
    audio.ensure_max_duration(path)
    wav = audio.decode(path)
    tracks: tuple[np.ndarray, np.ndarray] | None = None
    if separate and stems:
        tracks = separation.stems(wav)
        mono = tracks[0].mean(axis=0).astype(np.float32)
    elif separate:
        mono = separation.vocals(wav)
    else:
        mono = wav.mean(axis=0)
    midi = pitch.track(mono)
    if all(value is None for value in midi):
        raise WorkerError("no_voice", "nenhum frame com voz")
    duration_ms = audio.duration_ms(wav)
    # A letra é alinhada sobre a mesma voz isolada do crepe: sem segunda separação (sdd-010).
    selected = None
    transcript = None
    lines = lyrics.lyrics if lyrics else None
    if lyrics is not None and lyrics.candidates is not None:
        selected, transcript = _select_lyrics(mono, lyrics.candidates, lyrics.prompt, duration_ms, path.parent)
        lines = selected.lines
    aligned = alignment.align(mono, lines) if lines else None
    result = ExtractResponse(durationMs=duration_ms, midi=midi, alignment=aligned, lyrics=selected, transcript=transcript)
    if tracks is None:
        return result, None
    vocals_path, instrumental_path = path.parent / "vocals.m4a", path.parent / "instrumental.m4a"
    audio.encode_aac(tracks[0], vocals_path)
    audio.encode_aac(tracks[1], instrumental_path)
    return result, (vocals_path, instrumental_path)


async def _extract(
    path: Path, separate: bool, lyrics: LyricsInput | None, stems: bool = False
) -> tuple[ExtractResponse, StemPaths | None]:
    async with _extraction_lock:
        return await run_in_threadpool(_extract_sync, path, separate, lyrics, stems)


def _extract_response(result: ExtractResponse, stems: StemPaths | None, tmp_dir: Path):
    """JSON como sempre ou, com trilhas (sdd-016), o multipart `result` + `vocals` + `instrumental`
    em streaming do tmp, que só é limpo depois do último byte. Sem trilhas, o tmp é limpo já."""
    if stems is None:
        _cleanup(tmp_dir)
        return result
    vocals_path, instrumental_path = stems
    return _multipart_response(
        [
            ("result", result.model_dump_json().encode(), "application/json"),
            ("vocals", vocals_path, audio.STEMS_MEDIA_TYPE),
            ("instrumental", instrumental_path, audio.STEMS_MEDIA_TYPE),
        ],
        tmp_dir,
    )


def _align_sync(path: Path, separate: bool, current: list[LyricsLine], proposed: list[LyricsLine]) -> AlignResponse:
    """Conferência de uma revisão da letra (sdd-012): a mesma voz isolada, sem crepe nem
    Whisper, e as duas letras alinhadas sobre as mesmas emissões do wav2vec2."""
    audio.ensure_max_duration(path)
    wav = audio.decode(path)
    mono = separation.vocals(wav) if separate else wav.mean(axis=0)
    aligned_current, aligned_proposed = alignment.align_many(mono, [current, proposed])
    return AlignResponse(durationMs=audio.duration_ms(wav), current=aligned_current, proposed=aligned_proposed)


async def _align(path: Path, separate: bool, current: list[LyricsLine], proposed: list[LyricsLine]) -> AlignResponse:
    async with _extraction_lock:
        return await run_in_threadpool(_align_sync, path, separate, current, proposed)


STEMS_CHUNK = 1024 * 1024


def _stems_sync(path: Path, tmp_dir: Path) -> tuple[Path, Path]:
    """Separa a música em voz e instrumental (sdd-013) e grava as duas em AAC no tmp da
    requisição. Música instrumental devolve uma voz silenciosa (sem `no_voice`)."""
    audio.ensure_max_duration(path)
    wav = audio.decode(path)
    vocals, instrumental = separation.stems(wav)
    vocals_path, instrumental_path = tmp_dir / "vocals.m4a", tmp_dir / "instrumental.m4a"
    audio.encode_aac(vocals, vocals_path)
    audio.encode_aac(instrumental, instrumental_path)
    return vocals_path, instrumental_path


async def _stems(path: Path, tmp_dir: Path) -> tuple[Path, Path]:
    async with _extraction_lock:
        return await run_in_threadpool(_stems_sync, path, tmp_dir)


MultipartPart = tuple[str, bytes | Path, str]   # (nome, bytes em memória ou arquivo no tmp, media type)


def _multipart_part_header(boundary: str, name: str, payload: bytes | Path, media_type: str) -> bytes:
    filename = f'; filename="{payload.name}"' if isinstance(payload, Path) else ""
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{name}"{filename}\r\n'
        f"Content-Type: {media_type}\r\n\r\n"
    ).encode()


def _multipart_response(parts: list[MultipartPart], tmp_dir: Path) -> StreamingResponse:
    """Resposta `multipart/form-data`: partes em memória (o JSON do `/extract` com trilhas,
    sdd-016) ou arquivos do tmp em streaming (nada inteiro em memória), com `Content-Length`
    calculado dos tamanhos. O tmp é limpo DEPOIS do último byte, como no `/youtube/audio`."""
    boundary = f"cantor-stems-{uuid.uuid4().hex}"
    closing = f"--{boundary}--\r\n".encode()
    headers = [(_multipart_part_header(boundary, name, payload, media_type), payload) for name, payload, media_type in parts]
    content_length = (
        sum(len(header) + (payload.stat().st_size if isinstance(payload, Path) else len(payload)) + 2 for header, payload in headers)
        + len(closing)
    )

    def body() -> Iterator[bytes]:
        for header, payload in headers:
            yield header
            if isinstance(payload, Path):
                with payload.open("rb") as file:
                    while chunk := file.read(STEMS_CHUNK):
                        yield chunk
            else:
                yield payload
            yield b"\r\n"
        yield closing

    return StreamingResponse(
        body(),
        media_type=f"multipart/form-data; boundary={boundary}",
        headers={"content-length": str(content_length)},
        background=BackgroundTask(_cleanup, tmp_dir),
    )


def _parse_json_field(raw: str | None, adapter: TypeAdapter, message: str):
    """Campo JSON do multipart (`lyrics`, `lyricsCandidates`). Malformado → 400 invalid_lyrics."""
    if raw is None or raw == "":
        return None
    try:
        return adapter.validate_json(raw)
    except ValidationError as exc:
        raise WorkerError("invalid_lyrics", message) from exc


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


def _mark_handled(done: asyncio.Future) -> None:
    # A thread do yt-dlp continua até o socket_timeout; só marca a exceção como tratada.
    if not done.cancelled():
        done.exception()


async def _in_thread_with_timeout(fn, arg: str, timeout_s: float, label: str):
    loop = asyncio.get_running_loop()
    future = loop.run_in_executor(None, fn, arg)
    try:
        return await asyncio.wait_for(asyncio.shield(future), timeout=timeout_s)
    except TimeoutError as exc:
        future.add_done_callback(_mark_handled)
        raise WorkerError("search_failed", f"busca no {label} passou do tempo limite") from exc


async def _search(query: str) -> list[YoutubeCandidate]:
    return await _in_thread_with_timeout(youtube.search, query, SEARCH_TIMEOUT_S, "YouTube")


# ── Rotas ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        # Provedor principal da transcrição (sdd-014). `models.whisper` continua dizendo se o
        # Whisper **local** está carregado (com a OpenAI, só depois de a reserva ser usada).
        "transcription": transcription.provider(),
        # Device do Demucs e do MMS_FA (sdd-016): `cpu` ou `mps`; nulo só antes do boot resolver.
        "device": device.current(),
        "models": {
            "demucs": separation.is_loaded(),
            "crepe": pitch.is_loaded(),
            "mms_fa": alignment.is_loaded(),
            "whisper": transcription.is_loaded(),
        },
    }


EXTRACT_RESPONSES = {
    200: {
        "content": {"application/json": {}, "multipart/form-data": {}},
        "description": "JSON `ExtractResponse`; com `stems=true` e `separate=true` (sdd-016), `multipart/form-data` "
        "com as partes `result` (o mesmo JSON), `vocals` e `instrumental` (AAC `.m4a`).",
    },
    **ERROR_RESPONSES,
}


@app.post("/extract", response_model=ExtractResponse, responses=EXTRACT_RESPONSES)
async def extract(
    file: UploadFile = File(...),
    separate: bool = Form(True),
    lyrics: str | None = Form(None),
    lyricsCandidates: str | None = Form(None),
    lyricsPrompt: str | None = Form(None),
    stems: bool = Form(False),
):
    lines = _parse_json_field(lyrics, _lyrics_adapter, "lyrics precisa ser um JSON de [{ text, startMs? }]")
    candidates = _parse_json_field(
        lyricsCandidates, _candidates_adapter, "lyricsCandidates precisa ser um JSON de [{ source, lines }]"
    )
    _check_lyrics_input(lines, candidates)
    tmp_dir = _new_tmp_dir()
    try:
        path = await _save_upload(file, tmp_dir)
        result, stem_paths = await _extract(path, separate, LyricsInput(lines, candidates, lyricsPrompt), stems)
    except BaseException:
        _cleanup(tmp_dir)
        raise
    return _extract_response(result, stem_paths, tmp_dir)


@app.post("/stems", responses={200: {"content": {"multipart/form-data": {}}}, **ERROR_RESPONSES})
async def stems(file: UploadFile = File(...)) -> StreamingResponse:
    """Separa o áudio enviado em voz e instrumental (sdd-013): `multipart/form-data` com os
    arquivos `vocals` e `instrumental` (AAC .m4a, mesma taxa e mesmo número de amostras).
    Mesmos limites do `/extract`; nada fica no worker."""
    tmp_dir = _new_tmp_dir()
    try:
        path = await _save_upload(file, tmp_dir)
        vocals_path, instrumental_path = await _stems(path, tmp_dir)
    except BaseException:
        _cleanup(tmp_dir)
        raise
    # Os arquivos precisam existir até o último byte ser enviado: a limpeza roda DEPOIS.
    return _multipart_response(
        [("vocals", vocals_path, audio.STEMS_MEDIA_TYPE), ("instrumental", instrumental_path, audio.STEMS_MEDIA_TYPE)],
        tmp_dir,
    )


@app.post("/youtube/extract", response_model=ExtractResponse, responses=EXTRACT_RESPONSES)
async def youtube_extract(body: YoutubeRequest):
    youtube.validate_video_id(body.videoId)
    _check_lyrics_input(body.lyrics, body.lyricsCandidates)
    tmp_dir = _new_tmp_dir()
    try:
        path = await _download(body.videoId, tmp_dir)   # fora do semáforo
        lyrics = LyricsInput(body.lyrics, body.lyricsCandidates, body.lyricsPrompt)
        result, stem_paths = await _extract(path, body.separate, lyrics, body.stems)
    except BaseException:
        _cleanup(tmp_dir)
        raise
    return _extract_response(result, stem_paths, tmp_dir)


@app.post("/youtube/align", response_model=AlignResponse, responses=ERROR_RESPONSES)
async def youtube_align(body: AlignRequest) -> AlignResponse:
    """Alinha a letra atual e a proposta de uma revisão sobre a voz do vídeo (sdd-012). Nada é
    gravado: a API compara o score por verso e decide com o usuário."""
    youtube.validate_video_id(body.videoId)
    tmp_dir = _new_tmp_dir()
    try:
        path = await _download(body.videoId, tmp_dir)   # fora do semáforo
        return await _align(path, body.separate, body.current, body.proposed)
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


@app.post("/youtube/search", response_model=YoutubeSearchResponse, responses=ERROR_RESPONSES)
async def youtube_search(body: YoutubeSearchRequest) -> YoutubeSearchResponse:
    """Candidatos do YouTube para a consulta (sdd-008). Nada é baixado nem gravado."""
    query = youtube.validate_query(body.query)
    return YoutubeSearchResponse(candidates=await _search(query))   # fora do semáforo


@app.post("/ytmusic/search", response_model=YtmusicSearchResponse, responses=ERROR_RESPONSES)
async def ytmusic_search(body: YtmusicSearchRequest) -> YtmusicSearchResponse:
    """Músicas do YouTube Music (a busca do app, sdd-011); com `withLyrics`, a letra de cada uma."""
    query = youtube.validate_query(body.query)
    search = functools.partial(ytmusic.search, with_lyrics=body.withLyrics)
    songs = await _in_thread_with_timeout(search, query, YTMUSIC_TIMEOUT_S, "YouTube Music")
    return YtmusicSearchResponse(songs=songs)   # fora do semáforo


@app.post("/ytmusic/song", response_model=YtmusicSong, responses=ERROR_RESPONSES)
async def ytmusic_song(body: YtmusicSongRequest) -> YtmusicSong:
    """Metadados e letra de um vídeo (sdd-011): cadastro e coleta de letra da API."""
    video_id = youtube.validate_video_id(body.videoId)
    return await _in_thread_with_timeout(ytmusic.song, video_id, YTMUSIC_TIMEOUT_S, "YouTube Music")
