"""Busca de músicas e letras no YouTube Music com `ytmusicapi` (experimento: comparar com o LRCLIB).

API não oficial (a mesma que o app do YouTube Music usa), sem chave. A letra vem licenciada
(LyricFind, Musixmatch) e, na maioria das músicas, com o tempo de cada linha. Pode quebrar
sem aviso quando o YouTube Music muda: toda falha vira `search_failed`, e a falha da letra de
uma música só marca aquela música (`status: "error"`).

Projeto pessoal e não comercial, como o download do YouTube (`app/youtube.py`).
"""

import re
from concurrent.futures import ThreadPoolExecutor

from ytmusicapi import YTMusic

from app.errors import WorkerError
from app.schemas import YtmusicLyrics, YtmusicLyricsLine, YtmusicSong
from app.youtube import validate_query, validate_video_id

SEARCH_RESULTS = 8
# A letra custa 2 requisições por música (~1 s): em paralelo a busca inteira fica em ~2-4 s.
LYRICS_THREADS = 4

# Linhas que não são letra: marcação de trecho instrumental.
_NOT_LYRICS = {"", "♪"}


def _client() -> YTMusic:
    # Um cliente por thread: a sessão HTTP do ytmusicapi não é garantida entre threads.
    return YTMusic()


def _source(raw: object) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    return raw.removeprefix("Source:").strip() or None


def _lines_from_timed(raw: list) -> list[YtmusicLyricsLine]:
    lines = []
    for item in raw:
        text = str(getattr(item, "text", "")).strip()
        if text in _NOT_LYRICS:
            continue
        lines.append(YtmusicLyricsLine(text=text, startMs=int(item.start_time), endMs=int(item.end_time)))
    return lines


def _lines_from_text(raw: str) -> list[YtmusicLyricsLine]:
    return [
        YtmusicLyricsLine(text=line.strip(), startMs=None, endMs=None)
        for line in raw.splitlines()
        if line.strip() not in _NOT_LYRICS
    ]


def _lyrics_from_browse(client: YTMusic, browse_id: str | None) -> YtmusicLyrics:
    """Letra pelo `browseId` da aba "Letra" (vem no `get_watch_playlist`). Nunca lança."""
    try:
        data = client.get_lyrics(browse_id, timestamps=True) if browse_id else None
    except Exception:  # rede, mudança de formato do YouTube Music…
        return YtmusicLyrics(status="error", source=None, lines=[])
    return _parse_lyrics(data)


def lyrics(video_id: str) -> YtmusicLyrics:
    """Letra da música, com tempo quando o YouTube Music tem. Nunca lança."""
    try:
        client = _client()
        browse_id = client.get_watch_playlist(video_id, limit=1).get("lyrics")
    except Exception:  # rede, mudança de formato do YouTube Music…
        return YtmusicLyrics(status="error", source=None, lines=[])
    return _lyrics_from_browse(client, browse_id)


def _parse_lyrics(data: dict | None) -> YtmusicLyrics:

    if not data or not data.get("lyrics"):
        return YtmusicLyrics(status="none", source=None, lines=[])
    source = _source(data.get("source"))
    if data.get("hasTimestamps"):
        return YtmusicLyrics(status="synced", source=source, lines=_lines_from_timed(data["lyrics"]))
    return YtmusicLyrics(status="plain", source=source, lines=_lines_from_text(str(data["lyrics"])))


def _to_song(entry: dict, song_lyrics: YtmusicLyrics) -> YtmusicSong:
    artists = ", ".join(a["name"] for a in entry.get("artists") or [] if isinstance(a, dict) and a.get("name"))
    album = entry.get("album")
    duration = entry.get("duration_seconds")
    return YtmusicSong(
        videoId=entry["videoId"],
        title=str(entry.get("title") or ""),
        artist=artists,
        album=album.get("name") if isinstance(album, dict) else None,
        durationS=float(duration) if isinstance(duration, (int, float)) else None,
        lyrics=song_lyrics,
    )


def _duration_s(length: object) -> float | None:
    """"3:17" / "1:02:03" → segundos."""
    if not isinstance(length, str) or not re.fullmatch(r"\d+(:\d{2}){1,2}", length):
        return None
    seconds = 0
    for part in length.split(":"):
        seconds = seconds * 60 + int(part)
    return float(seconds)


def song(video_id: str) -> YtmusicSong:
    """Metadados e letra de um vídeo (sdd-011: cadastro e coleta de letra da API). Vídeo que
    o YouTube Music não conhece → `video_unavailable`; falha da lib → `search_failed`."""
    video_id = validate_video_id(video_id)
    try:
        client = _client()
        playlist = client.get_watch_playlist(video_id, limit=1)
    except Exception as exc:
        raise WorkerError("search_failed", f"ytmusicapi falhou no vídeo: {exc}") from exc

    tracks = [t for t in playlist.get("tracks") or [] if isinstance(t, dict) and t.get("videoId") == video_id]
    if not tracks:
        raise WorkerError("video_unavailable", "o YouTube Music não conhece este vídeo")
    track = tracks[0]
    entry = {**track, "duration_seconds": track.get("duration_seconds") or _duration_s(track.get("length"))}
    return _to_song(entry, _lyrics_from_browse(client, playlist.get("lyrics")))


def search(query: str, with_lyrics: bool = True) -> list[YtmusicSong]:
    """Até `SEARCH_RESULTS` músicas (filtro "songs"); com `with_lyrics`, a letra de cada uma
    (2 requisições a mais por música). Sem ela, `lyrics.status` vem `none`."""
    query = validate_query(query)
    try:
        results = _client().search(query, filter="songs")
    except Exception as exc:
        raise WorkerError("search_failed", f"ytmusicapi falhou na busca: {exc}") from exc

    entries = [
        entry
        for entry in results or []
        if isinstance(entry, dict) and isinstance(entry.get("videoId"), str) and entry.get("resultType") == "song"
    ][:SEARCH_RESULTS]
    if not with_lyrics:
        return [_to_song(entry, YtmusicLyrics(status="none", source=None, lines=[])) for entry in entries]
    with ThreadPoolExecutor(LYRICS_THREADS) as pool:
        found = list(pool.map(lyrics, (entry["videoId"] for entry in entries)))
    return [_to_song(entry, song_lyrics) for entry, song_lyrics in zip(entries, found)]
