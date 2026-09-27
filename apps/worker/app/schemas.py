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


# ── Alinhamento forçado da letra (sdd-010) ────────────────────────────


class LyricsLine(BaseModel):
    """Uma linha da letra como a API a conhece. `startMs` é o instante no LRC original: só
    serve para detectar intervalos longos entre linhas (trecho não transcrito), nunca é
    devolvido nem usado para posicionar a linha."""

    text: str
    startMs: int | None = None


class LineAlignment(BaseModel):
    index: int                  # posição em `lyrics`
    startMs: int | None         # None: linha sem texto alinhável (instrumental, só símbolos)
    endMs: int | None
    score: float | None         # média das probabilidades dos tokens da linha, 0..1


class Alignment(BaseModel):
    version: Literal[1] = 1
    model: Literal["mms_fa"] = "mms_fa"
    frameMs: Literal[20] = 20
    lines: list[LineAlignment]  # exatamente len(lyrics) itens, na mesma ordem


# ── Escolha da letra entre várias fontes (sdd-011) ────────────────────


class LyricsCandidate(BaseModel):
    """Uma letra encontrada pela API num site. `startMs` das linhas é opcional (letra só em
    texto)."""

    source: Literal["lrclib", "ytmusic"]
    lines: list[LyricsLine]


class CandidateScore(BaseModel):
    source: Literal["lrclib", "ytmusic"]
    wer: float | None           # None: candidata sem palavras ou transcrição vazia


class SelectedLyrics(BaseModel):
    """A letra escolhida: a candidata que mais combina com a transcrição da voz ou, se
    nenhuma combina, a própria transcrição (`whisper`). `startMs` sempre preenchido: é a dica
    que o alinhador usa (o tempo final vem do `alignment`)."""

    source: Literal["lrclib", "ytmusic", "whisper"]
    wer: float | None           # da escolhida contra a transcrição; None em `whisper`
    candidates: list[CandidateScore]
    lines: list[LyricsLine]


class TranscriptWord(BaseModel):
    """Uma palavra da transcrição do Whisper (sdd-012): o que foi ouvido, quando e com que
    confiança. A API guarda como evidência para a revisão da letra."""

    text: str
    startMs: int
    endMs: int
    probability: float


class ExtractResponse(PitchTrack):
    """`PitchTrack` mais o alinhamento da letra, quando o pedido trouxe `lyrics` ou
    `lyricsCandidates`; com `lyricsCandidates`, também a letra escolhida (`lyrics`), o
    `alignment` é sobre ela e `transcript` traz as palavras do Whisper (sdd-012)."""

    alignment: Alignment | None = None
    lyrics: SelectedLyrics | None = None
    transcript: list[TranscriptWord] | None = None


# ── Conferência de uma correção da letra (sdd-012) ────────────────────


class AlignRequest(BaseModel):
    """Alinha duas versões da letra (a atual e a proposta pela revisão) sobre a mesma voz
    isolada, numa passada só do wav2vec2: a API compara o score por verso antes e depois."""

    videoId: str
    separate: bool = True
    current: list[LyricsLine]
    proposed: list[LyricsLine]


class AlignResponse(BaseModel):
    durationMs: int
    current: Alignment | None
    proposed: Alignment | None


class YoutubeRequest(BaseModel):
    # Sem padrão aqui de propósito: o videoId é validado à mão para responder
    # 400 invalid_video_id (e não o 422 genérico do FastAPI).
    videoId: str
    separate: bool = True
    lyrics: list[LyricsLine] | None = None
    lyricsCandidates: list[LyricsCandidate] | None = None
    # "Artista - Título" para o prompt do Whisper (grafia de nomes); só com `lyricsCandidates`.
    lyricsPrompt: str | None = None
    # sdd-016: com `separate`, devolve também as trilhas (voz e instrumental em AAC) da MESMA
    # passada do Demucs, num `multipart/form-data` (`result` + `vocals` + `instrumental`).
    stems: bool = False


class YoutubeAudioRequest(BaseModel):
    videoId: str


class YoutubeSearchRequest(BaseModel):
    # Validada à mão (`youtube.validate_query`) para responder 400 invalid_query.
    query: str


class YoutubeCandidate(BaseModel):
    """Um resultado da busca (sdd-008), sem download. `durationS`/`viewCount` nulos quando o
    YouTube não informa; `isLive` marca ao vivo e estreias."""

    videoId: str
    title: str
    channel: str | None
    durationS: float | None
    viewCount: int | None
    isLive: bool = False


class YoutubeSearchResponse(BaseModel):
    candidates: list[YoutubeCandidate]


class YtmusicSearchRequest(BaseModel):
    # Validada à mão (`youtube.validate_query`) para responder 400 invalid_query.
    query: str
    # A busca da API manda `false`: sem letra, a busca cai de ~3 s para ~1 s (sdd-011).
    withLyrics: bool = True


class YtmusicSongRequest(BaseModel):
    videoId: str


class YtmusicLyricsLine(BaseModel):
    """Uma linha da letra do YouTube Music. Tempos em ms; nulos quando a letra é só texto."""

    text: str
    startMs: int | None
    endMs: int | None


class YtmusicLyrics(BaseModel):
    """`synced`: com tempo por linha · `plain`: só texto · `none`: a música não tem letra ·
    `error`: a busca da letra falhou (o resto da busca segue). `source` é quem licencia
    (LyricFind, Musixmatch)."""

    status: Literal["synced", "plain", "none", "error"]
    source: str | None
    lines: list[YtmusicLyricsLine]


class YtmusicSong(BaseModel):
    """Uma música do YouTube Music (experimento de fonte de letra). O `videoId` é o do áudio
    oficial, o mesmo que o YouTube toca."""

    videoId: str
    title: str
    artist: str
    album: str | None
    durationS: float | None
    lyrics: YtmusicLyrics


class YtmusicSearchResponse(BaseModel):
    songs: list[YtmusicSong]


class ErrorResponse(BaseModel):
    error: WorkerErrorCode
    message: str
