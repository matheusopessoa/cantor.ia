"""Download do YouTube com yt-dlp (como biblioteca). Só recebe videoId, nunca URL livre.

Projeto pessoal e não comercial (decisão do usuário em 2026-09-25): baixar do YouTube viola
os termos do YouTube e só é aceito nesse contexto.
"""

import re
import threading
from pathlib import Path

import yt_dlp
from yt_dlp.utils import DownloadCancelled, DownloadError

from app.audio import MAX_DURATION_S, MAX_FILE_BYTES
from app.errors import WorkerError

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Trechos de mensagem do yt-dlp que indicam vídeo que não abre (e não falha do download)
_UNAVAILABLE_HINTS = (
    "video unavailable",
    "private video",
    "sign in to confirm your age",
    "age-restricted",
    "inappropriate for some users",
    "has been removed",
    "not available",
    "members-only",
    "copyright",
    "this live event",
    "premieres in",
)


def validate_video_id(video_id: str) -> str:
    if not isinstance(video_id, str) or not VIDEO_ID_RE.fullmatch(video_id):
        raise WorkerError("invalid_video_id", "videoId precisa ter 11 caracteres [A-Za-z0-9_-]")
    return video_id


def canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={validate_video_id(video_id)}"


def _classify(exc: Exception) -> WorkerError:
    text = str(exc).lower()
    if any(hint in text for hint in _UNAVAILABLE_HINTS):
        return WorkerError("video_unavailable", f"vídeo indisponível: {exc}")
    return WorkerError("download_failed", f"yt-dlp falhou: {exc}")


def _base_options(tmp_dir: Path) -> dict:
    return {
        "format": "bestaudio[ext=m4a]/bestaudio",
        "outtmpl": str(tmp_dir / "audio.%(ext)s"),
        "noplaylist": True,
        "max_filesize": MAX_FILE_BYTES,
        "socket_timeout": 30,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "cachedir": False,
    }


def check_metadata(info: dict) -> None:
    """Recusa ao vivo, estreia e vídeo longo ANTES de baixar."""
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming", "post_live"):
        raise WorkerError("video_unavailable", "vídeo ao vivo ou estreia")
    duration = info.get("duration")
    if duration is not None and duration > MAX_DURATION_S:
        raise WorkerError("too_long", f"vídeo com {duration}s (máximo {MAX_DURATION_S}s)")


def download_audio(video_id: str, tmp_dir: Path, cancel: threading.Event | None = None) -> Path:
    """Baixa o melhor áudio (prefere m4a) para tmp_dir e devolve o caminho do arquivo.

    `cancel`: quando setado (timeout do endpoint), o hook de progresso aborta o download.
    Sem isso a thread continuaria baixando depois que o tmp já foi apagado, e o yt-dlp
    recriaria o diretório, deixando o áudio no disco.
    """
    url = canonical_url(video_id)
    options = _base_options(tmp_dir)
    cancel = cancel or threading.Event()

    def abort_if_cancelled(_: dict) -> None:
        if cancel.is_set():
            raise DownloadCancelled("cancelado por timeout")

    options["progress_hooks"] = [abort_if_cancelled]
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            if info is None:
                raise WorkerError("video_unavailable", "yt-dlp não retornou metadados")
            check_metadata(info)
            if cancel.is_set():
                raise DownloadCancelled("cancelado por timeout")
            ydl.process_ie_result(info, download=True)
    except WorkerError:
        raise
    except DownloadCancelled as exc:
        raise WorkerError("download_failed", "download cancelado por timeout") from exc
    except DownloadError as exc:
        raise _classify(exc) from exc
    except Exception as exc:  # yt-dlp levanta vários tipos internos
        raise _classify(exc) from exc

    files = [p for p in tmp_dir.glob("audio.*") if p.suffix not in (".part", ".ytdl")]
    if not files:
        # max_filesize faz o yt-dlp pular o download em silêncio
        raise WorkerError("too_large", "áudio maior que o limite de 20 MB")
    return files[0]
