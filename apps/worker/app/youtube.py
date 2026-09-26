"""Download e busca no YouTube com yt-dlp (como biblioteca).

O download só recebe videoId, nunca URL livre. A busca (sdd-008) recebe o texto de
artista/título que a API monta a partir do LRCLIB e devolve metadados sem baixar nada.

Projeto pessoal e não comercial (decisão do usuário em 2026-09-25): baixar do YouTube viola
os termos do YouTube e só é aceito nesse contexto.
"""

import logging
import re
import threading
from pathlib import Path

import yt_dlp
from yt_dlp.utils import DownloadCancelled, DownloadError

from app.audio import MAX_DURATION_S, MAX_FILE_BYTES
from app.errors import WorkerError
from app.schemas import YoutubeCandidate

log = logging.getLogger(__name__)

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Busca (sdd-008): quantos resultados o `ytsearch` devolve e o tamanho máximo da consulta.
SEARCH_RESULTS = 15
QUERY_MAX_LEN = 200

_LIVE_STATUSES = ("is_live", "is_upcoming", "post_live")

# O YouTube recusa downloads de vez em quando (403 no link do áudio, "confirm you're not a
# bot", conexão caída) e a mesma chamada passa segundos depois. Só `download_failed` é tentado
# de novo: vídeo indisponível, longo ou grande demais é definitivo. As esperas contam dentro do
# limite de 2 min do download (`main.DOWNLOAD_TIMEOUT_S`); o cancelamento corta a espera.
DOWNLOAD_ATTEMPTS = 3
RETRY_DELAYS_S = (2, 5)
_LOG_MESSAGE_MAX = 300

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
    if info.get("is_live") or info.get("live_status") in _LIVE_STATUSES:
        raise WorkerError("video_unavailable", "vídeo ao vivo ou estreia")
    duration = info.get("duration")
    if duration is not None and duration > MAX_DURATION_S:
        raise WorkerError("too_long", f"vídeo com {duration}s (máximo {MAX_DURATION_S}s)")


def _clear_attempt(tmp_dir: Path) -> None:
    """Apaga o que uma tentativa deixou (`audio.*`, `.part`) antes da próxima."""
    for leftover in tmp_dir.glob("audio.*"):
        leftover.unlink(missing_ok=True)


def download_audio(video_id: str, tmp_dir: Path, cancel: threading.Event | None = None) -> Path:
    """Baixa o melhor áudio (prefere m4a) para tmp_dir e devolve o caminho do arquivo.

    Falha passageira (`download_failed`) é tentada de novo até `DOWNLOAD_ATTEMPTS` vezes, com
    `RETRY_DELAYS_S` de espera; cada falha vai para o log com a mensagem do yt-dlp.

    `cancel`: quando setado (timeout do endpoint), o hook de progresso aborta o download e
    nenhuma nova tentativa começa. Sem isso a thread continuaria baixando depois que o tmp já
    foi apagado, e o yt-dlp recriaria o diretório, deixando o áudio no disco.
    """
    cancel = cancel or threading.Event()
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            return _download_once(video_id, tmp_dir, cancel)
        except WorkerError as exc:
            if exc.code != "download_failed" or cancel.is_set():
                raise
            log.warning(
                "download do YouTube falhou (%s, tentativa %d de %d): %s",
                video_id, attempt, DOWNLOAD_ATTEMPTS, exc.message[:_LOG_MESSAGE_MAX],
            )
            if attempt == DOWNLOAD_ATTEMPTS:
                raise
            _clear_attempt(tmp_dir)
            delay = RETRY_DELAYS_S[min(attempt - 1, len(RETRY_DELAYS_S) - 1)]
            if cancel.wait(delay):
                raise WorkerError("download_failed", "download cancelado por timeout") from exc
    raise AssertionError("inalcançável")


def _download_once(video_id: str, tmp_dir: Path, cancel: threading.Event) -> Path:
    url = canonical_url(video_id)
    options = _base_options(tmp_dir)

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


# ── Busca (sdd-008) ───────────────────────────────────────────────────


def validate_query(query: object) -> str:
    """Consulta de 1 a 200 caracteres, com espaços normalizados. Vazia ou longa → 400."""
    if not isinstance(query, str):
        raise WorkerError("invalid_query", "query precisa ser texto")
    cleaned = " ".join(query.split())
    if not cleaned or len(cleaned) > QUERY_MAX_LEN:
        raise WorkerError("invalid_query", f"query precisa ter de 1 a {QUERY_MAX_LEN} caracteres")
    return cleaned


def _search_options() -> dict:
    # `extract_flat`: só a lista de resultados, sem abrir cada vídeo (1 requisição, ~1-2 s).
    # Sem `outtmpl`: nada é gravado em disco.
    return {
        "extract_flat": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 15,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "cachedir": False,
    }


def _number(value: object) -> int | float | None:
    # `bool` é subclasse de `int`: nunca deve virar duração ou contagem.
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _to_candidate(entry: dict) -> YoutubeCandidate | None:
    """Mapeia um resultado flat do yt-dlp. Sem id válido ou título, descarta."""
    video_id = entry.get("id")
    title = entry.get("title")
    if not isinstance(video_id, str) or not VIDEO_ID_RE.fullmatch(video_id):
        return None
    if not isinstance(title, str) or not title.strip():
        return None

    channel = entry.get("channel") or entry.get("uploader")
    duration = _number(entry.get("duration"))
    view_count = _number(entry.get("view_count"))
    is_live = bool(entry.get("is_live")) or entry.get("live_status") in _LIVE_STATUSES

    return YoutubeCandidate(
        videoId=video_id,
        title=title.strip(),
        channel=channel.strip() if isinstance(channel, str) and channel.strip() else None,
        durationS=float(duration) if duration is not None else None,
        viewCount=int(view_count) if view_count is not None else None,
        isLive=is_live,
    )


def search(query: str) -> list[YoutubeCandidate]:
    """`ytsearch15:<query>` sem download: id, título, canal, duração e visualizações."""
    query = validate_query(query)
    try:
        with yt_dlp.YoutubeDL(_search_options()) as ydl:
            info = ydl.extract_info(f"ytsearch{SEARCH_RESULTS}:{query}", download=False)
    except WorkerError:
        raise
    except Exception as exc:  # DownloadError, ExtractorError, rede…
        raise WorkerError("search_failed", f"yt-dlp falhou na busca: {exc}") from exc

    entries = (info or {}).get("entries") or []
    candidates = (_to_candidate(entry) for entry in entries if isinstance(entry, dict))
    return [candidate for candidate in candidates if candidate is not None][:SEARCH_RESULTS]
