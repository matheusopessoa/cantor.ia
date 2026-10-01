"""Alinhamento forçado da letra sobre a voz isolada (CTC com `torchaudio.pipelines.MMS_FA`).

A letra é conhecida linha a linha; o wav2vec2 do MMS_FA dá, a cada 20 ms, a probabilidade de
cada caractere romanizado, e o `forced_align` acha o caminho que canta a letra inteira em
ordem. Cada linha ganha o instante do primeiro e do último caractere e a média das
probabilidades dos seus tokens (`score`), que a API usa para aceitar ou recusar a linha.
Plano: `specs/sdd-010-lyrics-forced-alignment/tasks.md` §3.
"""

import logging
import unicodedata

import numpy as np
import torch
import torchaudio.functional as F
from torchaudio.pipelines import MMS_FA

from app import device
from app.audio import SAMPLE_RATE
from app.schemas import Alignment, LineAlignment, LyricsLine

log = logging.getLogger(__name__)

MODEL_SAMPLE_RATE = MMS_FA.sample_rate      # 16 kHz
FRAME_MS = 20                               # 320 amostras a 16 kHz por frame do wav2vec2
CHUNK_S = 20                                # janelas sem sobreposição: limita a memória da atenção
STAR_GAP_MS = 4_000                         # intervalo no LRC acima disto ganha um `*` (áudio não transcrito)
# O torchaudio dá ao `*` log-prob 0 (probabilidade 1) em todo frame, e ele engole o começo da
# linha seguinte (Infiel: 1ª linha 1,36 s atrasada no spike). Com −2 (p ≈ 0,14) ele só vence
# onde nenhum caractere da letra nem o blank explicam o áudio (adlib, refrão a mais).
STAR_LOG_PROB = -2.0
MIN_TOKENS = 2                              # linha com menos caracteres que isto não é alinhada
STAR = "*"
BLANK_ID = 0

_model: torch.nn.Module | None = None
# Alfabeto romanizado do MMS_FA (`-` = blank em 0, `*` por último). Estático: não baixa nada.
_DICTIONARY: dict[str, int] = MMS_FA.get_dict(star=STAR)
_STAR_ID = _DICTIONARY[STAR]


def load() -> None:
    """Carrega os pesos do MMS_FA uma vez (lifespan do FastAPI), no device de `app/device.py`
    (sdd-016). Baixa ~1,2 GB na primeira vez."""
    global _model
    if _model is None:
        _model = MMS_FA.get_model(with_star=True).to(device.resolve())


def is_loaded() -> bool:
    return _model is not None


def normalize_line(text: str) -> list[str]:
    """Texto da linha → caracteres alinháveis: NFKD sem marcas combinantes (acentos, cedilha),
    minúsculas, só `a-z`. Espaços, pontuação, dígitos e o resto somem.

    O apóstrofo existe no alfabeto do MMS_FA, mas em letra cantada ele marca elisão
    (`'tava`) e não um som: fica de fora, como o §6 do plano pede (`naotavaali`).
    """
    decomposed = unicodedata.normalize("NFKD", text)
    return [c for c in decomposed.lower() if "a" <= c <= "z"]


def emissions(mono: np.ndarray) -> torch.Tensor:
    """Voz mono a 44,1 kHz → log-probs `(T, C)` do wav2vec2, um frame a cada 20 ms.

    Reamostra para 16 kHz e roda o modelo em janelas de `CHUNK_S` sem sobreposição; cada
    janela perde no máximo 1 frame na borda, então `T ≈ duração / 20 ms`. A coluna do `*`
    recebe `STAR_LOG_PROB` fixo (ver o comentário da constante). Só o modelo roda no device
    (sdd-016): a entrada vai para lá janela a janela e as emissões voltam para a CPU, onde o
    `forced_align` roda.
    """
    load()
    assert _model is not None
    target = device.resolve()
    wav = torch.from_numpy(np.ascontiguousarray(mono, dtype=np.float32))
    wav = F.resample(wav, SAMPLE_RATE, MODEL_SAMPLE_RATE)
    chunk = CHUNK_S * MODEL_SAMPLE_RATE
    min_samples = MODEL_SAMPLE_RATE // 10      # 100 ms: abaixo disto as convoluções não fecham
    outputs: list[torch.Tensor] = []
    with torch.inference_mode():
        for start in range(0, wav.numel(), chunk):
            piece = wav[start:start + chunk]
            if piece.numel() < min_samples:
                piece = torch.nn.functional.pad(piece, (0, min_samples - piece.numel()))
            emission, _ = _model(piece[None].to(target))
            outputs.append(emission[0].cpu())
    log_probs = torch.cat(outputs).float()
    log_probs[:, _STAR_ID] = STAR_LOG_PROB
    return log_probs


def _targets(lines: list[LyricsLine]) -> tuple[list[int], list[tuple[int, int] | None]]:
    """Sequência de tokens do CTC e, por linha, a fatia `(ini, fim)` dela nos tokens (ou
    `None` para linha sem texto alinhável). `*` entra antes de linha que vem depois de um
    intervalo longo no LRC e no fim (outro, adlibs), para o áudio não transcrito não puxar
    a linha vizinha."""
    tokens: list[int] = []
    spans: list[tuple[int, int] | None] = []
    previous_start: int | None = None

    for line in lines:
        chars = normalize_line(line.text)
        gap = None if line.startMs is None or previous_start is None else line.startMs - previous_start
        if previous_start is None and line.startMs is not None and line.startMs > STAR_GAP_MS:
            tokens.append(_STAR_ID)                  # intro longa antes da primeira linha
        elif gap is not None and gap > STAR_GAP_MS:
            tokens.append(_STAR_ID)
        if line.startMs is not None:
            previous_start = line.startMs

        if len(chars) < MIN_TOKENS:
            spans.append(None)
            continue
        start = len(tokens)
        tokens.extend(_DICTIONARY[c] for c in chars)
        spans.append((start, len(tokens)))

    if tokens:
        tokens.append(_STAR_ID)
    return tokens, spans


def _frames_needed(tokens: list[int]) -> int:
    """O CTC precisa de um frame por token mais um blank entre tokens iguais consecutivos."""
    repeats = sum(1 for a, b in zip(tokens, tokens[1:]) if a == b)
    return len(tokens) + repeats


def align_lines(log_probs: torch.Tensor, lines: list[LyricsLine]) -> list[LineAlignment]:
    """Um `LineAlignment` por linha, na ordem. Linha sem texto alinhável → `None` nos campos;
    mais tokens que frames (ou nada alinhável) → `None` em todas, sem lançar."""
    empty = [LineAlignment(index=i, startMs=None, endMs=None, score=None) for i in range(len(lines))]
    tokens, spans = _targets(lines)
    frames = int(log_probs.shape[0])
    if sum(1 for s in spans if s is not None) == 0 or _frames_needed(tokens) > frames:
        return empty

    targets = torch.tensor([tokens], dtype=torch.int32)
    path, scores = F.forced_align(log_probs[None], targets, blank=BLANK_ID)
    token_spans = F.merge_tokens(path[0], scores[0].exp(), blank=BLANK_ID)
    if len(token_spans) != len(tokens):
        log.warning("forced_align devolveu %d spans para %d tokens", len(token_spans), len(tokens))
        return empty

    result: list[LineAlignment] = []
    for index, span in enumerate(spans):
        if span is None:
            result.append(empty[index])
            continue
        start, end = span
        line_spans = token_spans[start:end]
        result.append(
            LineAlignment(
                index=index,
                startMs=line_spans[0].start * FRAME_MS,
                endMs=line_spans[-1].end * FRAME_MS,
                score=round(float(np.mean([s.score for s in line_spans])), 4),
            )
        )
    return result


def _alignable(lines: list[LyricsLine]) -> bool:
    return bool(lines) and any(len(normalize_line(line.text)) >= MIN_TOKENS for line in lines)


def align_many(mono: np.ndarray, lyrics: list[list[LyricsLine]]) -> list[Alignment | None]:
    """Várias letras sobre a mesma voz isolada (sdd-012: a atual e a proposta de uma revisão),
    com **uma** passada do wav2vec2 (`emissions`) e um `forced_align` por letra. Um item por
    letra, na ordem; `None` para letra sem texto alinhável ou quando o alinhador falha."""
    results: list[Alignment | None] = [None] * len(lyrics)
    if not any(_alignable(lines) for lines in lyrics):
        return results
    try:
        log_probs = emissions(mono)
    except Exception:  # noqa: BLE001 — degradação controlada: a melodia não pode falhar por causa da letra
        log.exception("alinhamento forçado falhou; a API cai no método por pausas")
        return results
    for index, lines in enumerate(lyrics):
        if not _alignable(lines):
            continue
        try:
            results[index] = Alignment(lines=align_lines(log_probs, lines))
        except Exception:  # noqa: BLE001
            log.exception("alinhamento forçado da letra %d falhou", index)
    return results


def align(mono: np.ndarray, lines: list[LyricsLine]) -> Alignment | None:
    """Voz isolada (mono, 44,1 kHz) + letra → `Alignment`, ou `None` quando não há linha com
    texto alinhável ou quando o alinhador falha (a curva de pitch continua valendo; a API
    cai no método por pausas)."""
    return align_many(mono, [lines])[0]
