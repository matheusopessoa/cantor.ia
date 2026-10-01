"""Transcrição da voz isolada com o tempo de cada palavra (sdd-011), por dois provedores atrás
da mesma `transcribe(mono, prompt) -> Transcript` (sdd-014):

- **`openai`** (com `OPENAI_API_KEY`): `whisper-1` na API da OpenAI (`verbose_json` com tempo
  por palavra e por segmento). Tira da CPU do worker o passo mais pesado depois do Demucs.
- **`local`** (sem a chave, ou reserva quando a OpenAI falha): `faster-whisper`
  `large-v3-turbo` int8 na CPU. Com chave, só carrega na primeira vez que a reserva é usada.

A transcrição serve para duas coisas: escolher, entre as letras dos sites, a que combina com o
que é cantado nesta gravação, e virar a letra quando nenhuma combina
(`app/lyrics_selection.py`). O tempo final de cada verso continua vindo do MMS_FA
(`app/alignment.py`): o do Whisper é só dica. Só a voz isolada sai da máquina, nunca a URL nem
outros metadados além do `prompt` ("artista - título").
"""

import logging
import math
import re
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
import numpy as np
import torch
import torchaudio.functional as F
from pydantic import BaseModel

from app import audio, config
from app.audio import SAMPLE_RATE

log = logging.getLogger(__name__)

# ── Local (reserva) ───────────────────────────────────────────────────
MODEL_NAME = "large-v3-turbo"
COMPUTE_TYPE = "int8"
MODEL_SAMPLE_RATE = 16_000
# Palavra com probabilidade média abaixo disto num verso inteiro costuma ser invenção do
# Whisper em trecho sem voz (R6 da sdd-011): o verso é descartado.
MIN_SEGMENT_PROBABILITY = 0.4

# ── OpenAI ────────────────────────────────────────────────────────────
OPENAI_MODEL = "whisper-1"             # o único da OpenAI com tempo por palavra
OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"
OPENAI_TIMEOUT_S = 120
OPENAI_RETRY_DELAY_S = 2               # 1 nova tentativa em rede, timeout, 429 e 5xx
# O `prompt` aceita até 224 tokens; "artista - título" nunca chega perto, mas corta por garantia.
OPENAI_PROMPT_MAX_CHARS = 500
# Filtro de invenção sem VAD nem probabilidade por palavra (R6 da sdd-011): a heurística padrão
# do próprio Whisper. Segmento "silencioso" (as duas condições) ou repetido em laço sai inteiro.
NO_SPEECH_MAX = 0.6
LOGPROB_MIN = -1.0
COMPRESSION_MAX = 2.4

# A OpenAI devolve o idioma por extenso; o local, o código. Só informativo.
_LANGUAGE_CODES = {
    "portuguese": "pt", "english": "en", "spanish": "es", "french": "fr", "italian": "it",
    "german": "de", "japanese": "ja", "korean": "ko", "chinese": "zh", "russian": "ru",
}
_LEADING_NON_WORD = re.compile(r"^[\W_]+")

_model = None
_load_lock = threading.Lock()
# Para os testes: um `httpx.MockTransport` no lugar da rede.
_transport: httpx.BaseTransport | None = None


@dataclass(frozen=True)
class Word:
    text: str           # como o Whisper escreveu (com pontuação e espaço à esquerda removidos)
    startMs: int
    endMs: int
    probability: float


@dataclass(frozen=True)
class Transcript:
    words: list[Word]
    language: str | None


class OpenAITranscriptionError(Exception):
    """Falha da OpenAI. A mensagem tem só o status e o `error.type`: nunca a chave."""

    def __init__(self, message: str, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


def provider() -> Literal["openai", "local"]:
    """O provedor principal: `openai` com a chave configurada, senão `local`."""
    return "openai" if config.settings().OPENAI_API_KEY is not None else "local"


def load() -> None:
    """Carrega o modelo local uma vez. Baixa ~1,6 GB na primeira vez. Idempotente e seguro entre
    threads (a reserva pode carregá-lo no meio de uma extração)."""
    global _model
    with _load_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            _model = WhisperModel(MODEL_NAME, device="cpu", compute_type=COMPUTE_TYPE)


def is_loaded() -> bool:
    """Se o modelo **local** está carregado (a OpenAI não carrega nada)."""
    return _model is not None


def transcribe(
    mono: np.ndarray, prompt: str | None = None, tmp_dir: Path | None = None, language: str | None = None
) -> Transcript:
    """Voz mono a 44,1 kHz → palavras com tempo. `prompt` (artista e título) só ajuda a grafia
    de nomes: o Whisper não "conhece" a letra. `language` (ISO 639-1, ex.: "pt"): a língua da
    música quando se sabe (`lyrics_selection.guess_language`); sem ela, o Whisper adivinha pelo
    começo do áudio e às vezes transcreve na língua errada.

    Com a chave, tenta a OpenAI; qualquer falha dela (rede, timeout, 5xx depois de uma nova
    tentativa, 401, resposta malformada) cai no Whisper local, sem derrubar a extração. `tmp_dir`
    é o diretório temporário da requisição, onde o MP3 enviado fica até a resposta chegar.
    """
    if provider() == "openai":
        try:
            return _openai(mono, prompt, tmp_dir, language)
        except Exception as exc:  # noqa: BLE001 — degradação controlada: a reserva local cobre
            log.warning("transcrição pela OpenAI falhou (%s); usando o Whisper local", _describe(exc))
    return _local(mono, prompt, language)


# ── Local ─────────────────────────────────────────────────────────────


def _local(mono: np.ndarray, prompt: str | None, language: str | None = None) -> Transcript:
    """`condition_on_previous_text=False` e `vad_filter`: sem eles o Whisper repete o refrão em
    laço e escreve texto em trecho sem voz."""
    load()
    assert _model is not None
    wav = torch.from_numpy(np.ascontiguousarray(mono, dtype=np.float32))
    audio16k = F.resample(wav, SAMPLE_RATE, MODEL_SAMPLE_RATE).numpy()
    segments, info = _model.transcribe(
        audio16k,
        initial_prompt=prompt,
        language=language,
        word_timestamps=True,
        condition_on_previous_text=False,
        vad_filter=True,
    )
    words: list[Word] = []
    for segment in segments:
        seg_words = [w for w in segment.words or [] if w.word.strip()]
        if not seg_words:
            continue
        if float(np.mean([w.probability for w in seg_words])) < MIN_SEGMENT_PROBABILITY:
            continue
        words.extend(
            Word(text=w.word.strip(), startMs=round(w.start * 1000), endMs=round(w.end * 1000), probability=float(w.probability))
            for w in seg_words
        )
    return Transcript(words=words, language=info.language)


# ── OpenAI ────────────────────────────────────────────────────────────


class _OpenAIWord(BaseModel):
    word: str
    start: float
    end: float


class _OpenAISegment(BaseModel):
    start: float
    end: float
    avg_logprob: float
    no_speech_prob: float
    compression_ratio: float


class _OpenAIBody(BaseModel):
    language: str | None = None
    words: list[_OpenAIWord]
    segments: list[_OpenAISegment]


def _is_invented(segment: _OpenAISegment) -> bool:
    silent = segment.no_speech_prob > NO_SPEECH_MAX and segment.avg_logprob < LOGPROB_MIN
    return silent or segment.compression_ratio > COMPRESSION_MAX


def _language_code(language: str | None) -> str | None:
    if language is None:
        return None
    lowered = language.strip().lower()
    return _LANGUAGE_CODES.get(lowered, lowered)


def _from_openai(body: dict) -> Transcript:
    """`verbose_json` do `whisper-1` → `Transcript`. Puro. Cada palavra pertence ao segmento que
    contém o seu início: herda dele a probabilidade (`exp(avg_logprob)`; a OpenAI não dá por
    palavra) e sai junto se o segmento for invenção. Palavra fora de qualquer segmento fica com
    probabilidade 1 e não é filtrada. Formato inesperado → `ValidationError` (vai para a reserva)."""
    parsed = _OpenAIBody.model_validate(body)
    segments = sorted(parsed.segments, key=lambda s: s.start)

    words: list[Word] = []
    for item in parsed.words:
        text = _LEADING_NON_WORD.sub("", item.word.strip())
        if not text:
            continue
        segment = next((s for s in segments if s.start <= item.start <= s.end), None)
        if segment is not None and _is_invented(segment):
            continue
        probability = 1.0 if segment is None else min(1.0, max(0.0, math.exp(segment.avg_logprob)))
        words.append(Word(text=text, startMs=round(item.start * 1000), endMs=round(item.end * 1000), probability=round(probability, 4)))
    return Transcript(words=words, language=_language_code(parsed.language))


def _describe(exc: Exception) -> str:
    """Resumo da falha para o log: tipo e, na OpenAI, o status e o `error.type`. Sem a chave."""
    if isinstance(exc, OpenAITranscriptionError):
        return str(exc)
    return type(exc).__name__


def _api_error(response: httpx.Response) -> OpenAITranscriptionError:
    error_type = None
    try:
        payload = response.json()
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            error_type = payload["error"].get("type") or payload["error"].get("code")
    except ValueError:
        pass
    retryable = response.status_code == 429 or response.status_code >= 500
    return OpenAITranscriptionError(
        f"OpenAI respondeu {response.status_code}" + (f" ({error_type})" if error_type else ""),
        status=response.status_code,
        retryable=retryable,
    )


def _post(client: httpx.Client, mp3: Path, prompt: str | None, key: str, language: str | None = None) -> dict:
    data: dict[str, str | list[str]] = {
        "model": OPENAI_MODEL,
        "response_format": "verbose_json",
        "timestamp_granularities[]": ["word", "segment"],
    }
    if prompt:
        data["prompt"] = prompt[:OPENAI_PROMPT_MAX_CHARS]
    if language:
        data["language"] = language
    try:
        with mp3.open("rb") as file:
            response = client.post(
                OPENAI_URL,
                headers={"Authorization": f"Bearer {key}"},
                data=data,
                files={"file": (mp3.name, file, "audio/mpeg")},
            )
    except httpx.TransportError as exc:   # rede e timeout
        raise OpenAITranscriptionError(f"sem resposta da OpenAI ({type(exc).__name__})", retryable=True) from exc
    if response.status_code != 200:
        raise _api_error(response)
    try:
        return response.json()
    except ValueError as exc:
        raise OpenAITranscriptionError("OpenAI respondeu 200 sem JSON") from exc


def _openai(mono: np.ndarray, prompt: str | None, tmp_dir: Path | None, language: str | None = None) -> Transcript:
    secret = config.settings().OPENAI_API_KEY
    assert secret is not None
    key = secret.get_secret_value()

    own_tmp = tmp_dir is None
    directory = Path(tempfile.mkdtemp(prefix="cantor-worker-transcribe-")) if own_tmp else tmp_dir
    mp3 = directory / "voice-transcription.mp3"
    try:
        audio.encode_mp3(mono, mp3)
        with httpx.Client(timeout=OPENAI_TIMEOUT_S, transport=_transport) as client:
            try:
                body = _post(client, mp3, prompt, key, language)
            except OpenAITranscriptionError as exc:
                if not exc.retryable:
                    raise
                log.info("OpenAI: %s; nova tentativa em %s s", exc, OPENAI_RETRY_DELAY_S)
                time.sleep(OPENAI_RETRY_DELAY_S)
                body = _post(client, mp3, prompt, key, language)
        return _from_openai(body)
    finally:
        mp3.unlink(missing_ok=True)
        if own_tmp:
            shutil.rmtree(directory, ignore_errors=True)
