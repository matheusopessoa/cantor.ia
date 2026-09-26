"""Curva de pitch com torchcrepe: um valor MIDI a cada 10 ms, ou None quando não há voz."""

import math

import numpy as np
import torch
import torchcrepe

from app.audio import SAMPLE_RATE

HOP_MS = 10
HOP_SAMPLES = SAMPLE_RATE * HOP_MS // 1000     # 441 a 44.1 kHz (vira 160 a 16 kHz no crepe)
PERIODICITY_THRESHOLD = 0.5
FMIN_HZ = 65.0      # ~C2
FMAX_HZ = 1100.0    # ~C#6
SILENCE_DB = -60.0
RMS_WINDOW = 2048
# "tiny" em vez de "full": mesma precisão para a nota (benchmark de 2026-09-25 na sdd-001:
# erro mediano 6 cents nos dois, 0,1% de frames divergindo > 50 cents), 10x mais rápido e
# 4x menos RAM. O "full" levava ~6 min por música e passava de 8 GB.
MODEL_CAPACITY = "tiny"
BATCH_SIZE = 256      # frames por lote: lotes grandes estouram a RAM

_loaded = False


def load() -> None:
    """Carrega os pesos do crepe uma vez (lifespan do FastAPI)."""
    global _loaded
    if not _loaded:
        torchcrepe.load.model("cpu", MODEL_CAPACITY)
        _loaded = True


def is_loaded() -> bool:
    return _loaded


_CENTS = torchcrepe.convert.bins_to_cents(torch.arange(torchcrepe.PITCH_BINS))[None, :, None]


def weighted_viterbi(logits: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """Viterbi escolhe o bin (sem saltos de oitava); a média ponderada dos ±4 bins vizinhos
    dá precisão abaixo dos 20 cents de cada bin. O torchcrepe 0.0.24 não tem esse decoder."""
    bins, _ = torchcrepe.decode.viterbi(logits)
    offsets = torch.arange(-4, 5, device=logits.device)[None, :, None]
    window = (bins[:, None, :] + offsets).clamp(0, torchcrepe.PITCH_BINS - 1)
    with torch.no_grad():
        probs = torch.sigmoid(torch.gather(logits, 1, window))
    cents = torch.gather(_CENTS.to(logits.device).expand_as(logits), 1, window)
    weighted = (cents * probs).sum(dim=1) / probs.sum(dim=1)
    return bins, torchcrepe.convert.cents_to_frequency(weighted)


def hz_to_midi(hz: float) -> float:
    return round(69 + 12 * math.log2(hz / 440.0), 2)


def frame_rms_db(mono: np.ndarray, n_frames: int) -> np.ndarray:
    """RMS em dB de uma janela centrada em cada frame (mesmo índice do crepe)."""
    half = RMS_WINDOW // 2
    padded = np.pad(mono, (half, half))
    out = np.empty(n_frames, dtype=np.float64)
    for i in range(n_frames):
        start = i * HOP_SAMPLES
        window = padded[start:start + RMS_WINDOW]
        rms = float(np.sqrt(np.mean(np.square(window, dtype=np.float64)))) if window.size else 0.0
        out[i] = 20 * math.log10(rms) if rms > 0 else -math.inf
    return out


def track(mono: np.ndarray) -> list[float | None]:
    """Recebe voz mono a 44.1 kHz e devolve MIDI por frame de 10 ms (None = sem voz)."""
    load()
    audio = torch.from_numpy(mono.astype(np.float32)).unsqueeze(0)
    pitch, periodicity = torchcrepe.predict(
        audio,
        SAMPLE_RATE,
        hop_length=HOP_SAMPLES,
        fmin=FMIN_HZ,
        fmax=FMAX_HZ,
        model=MODEL_CAPACITY,
        decoder=weighted_viterbi,
        return_periodicity=True,
        batch_size=BATCH_SIZE,
        device="cpu",
        pad=True,
    )
    hz = pitch.squeeze(0).numpy()
    conf = periodicity.squeeze(0).numpy()
    loudness = frame_rms_db(mono, len(hz))

    midi: list[float | None] = []
    for f, p, db in zip(hz, conf, loudness):
        voiced = p >= PERIODICITY_THRESHOLD and db >= SILENCE_DB and FMIN_HZ <= f <= FMAX_HZ
        midi.append(hz_to_midi(float(f)) if voiced else None)
    return midi
