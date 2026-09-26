"""Decodificação de áudio com ffmpeg (qualquer formato que ele leia) para numpy float32."""

import json
import subprocess
from pathlib import Path

import numpy as np

from app.errors import WorkerError

SAMPLE_RATE = 44_100          # taxa do Demucs htdemucs
CHANNELS = 2                  # o Demucs espera estéreo
MAX_DURATION_S = 600          # 10 min
MAX_FILE_BYTES = 20 * 1024 * 1024


def probe_duration_s(path: Path) -> float:
    """Duração em segundos via ffprobe. Arquivo ilegível → invalid_audio."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    try:
        duration = float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise WorkerError("invalid_audio", "ffprobe não conseguiu ler o arquivo") from exc
    if result.returncode != 0 or duration <= 0:
        raise WorkerError("invalid_audio", "ffprobe não conseguiu ler o arquivo")
    return duration


def ensure_max_duration(path: Path) -> float:
    duration = probe_duration_s(path)
    if duration > MAX_DURATION_S:
        raise WorkerError("too_long", f"áudio com {duration:.0f}s (máximo {MAX_DURATION_S}s)")
    return duration


def decode(path: Path) -> np.ndarray:
    """Decodifica para float32 com shape (CHANNELS, amostras) a SAMPLE_RATE."""
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-nostdin",
            "-i", str(path),
            "-vn",
            "-f", "f32le",
            "-ac", str(CHANNELS),
            "-ar", str(SAMPLE_RATE),
            "pipe:1",
        ],
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0 or not result.stdout:
        raise WorkerError("invalid_audio", "ffmpeg não conseguiu decodificar o arquivo")
    samples = np.frombuffer(result.stdout, dtype=np.float32)
    return samples.reshape(-1, CHANNELS).T.copy()


def duration_ms(wav: np.ndarray) -> int:
    return round(wav.shape[-1] / SAMPLE_RATE * 1000)


def to_mp3(src: Path, dst: Path) -> None:
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(src), "-vn", "-codec:a", "libmp3lame", "-q:a", "2", str(dst)],
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise WorkerError("download_failed", "ffmpeg não conseguiu converter o áudio para MP3")
