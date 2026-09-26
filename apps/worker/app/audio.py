"""Decodificação de áudio com ffmpeg (qualquer formato que ele leia) para numpy float32, e a
codificação das trilhas separadas (sdd-013) em AAC."""

import json
import subprocess
from pathlib import Path

import numpy as np

from app.errors import WorkerError

SAMPLE_RATE = 44_100          # taxa do Demucs htdemucs
CHANNELS = 2                  # o Demucs espera estéreo
MAX_DURATION_S = 600          # 10 min
MAX_FILE_BYTES = 20 * 1024 * 1024
# Trilhas separadas (sdd-013): AAC em .m4a, o mesmo formato do áudio do YouTube. Na Etapa 0,
# ffmpeg (Chromium) e CoreAudio (Safari) decodificam as duas com atraso 0 e o mesmo número de
# amostras do WAV. 112 kbps por trilha: numa música real a voz não comprime mais que o
# instrumental (a 128 kbps as duas davam 2,02× o original de 128 kbps do YouTube; o plano pede
# ≤ 2×), e a 112 kbps as duas ficam em ~1,75×. Ver o README.
STEMS_MEDIA_TYPE = "audio/mp4"
STEMS_BITRATE = "112k"


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


def encode_mp3(mono: np.ndarray, dst: Path, sample_rate: int = 16_000, bitrate: str = "64k") -> Path:
    """Grava a voz mono (float32 a SAMPLE_RATE) como MP3 mono em `dst`, reamostrada para
    `sample_rate` (sdd-014: o que vai para a transcrição da OpenAI; 10 min a 64 kbps ≈ 4,8 MB,
    abaixo do limite de 25 MB). `dst` fica no tmp da requisição. Falha do ffmpeg é bug de
    ambiente: sobe como `RuntimeError` (a transcrição cai na reserva local)."""
    pcm = np.ascontiguousarray(mono, dtype=np.float32).tobytes()
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-nostdin", "-y",
            "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-i", "pipe:0",
            "-ac", "1", "-ar", str(sample_rate),
            "-codec:a", "libmp3lame", "-b:a", bitrate,
            str(dst),
        ],
        input=pcm,
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
        raise RuntimeError("ffmpeg não conseguiu codificar a voz em MP3")
    return dst


def encode_aac(samples: np.ndarray, dst: Path) -> None:
    """Grava (CHANNELS, amostras) float32 a SAMPLE_RATE como AAC em `dst` (.m4a). Falha do
    ffmpeg é bug de ambiente, não do arquivo do usuário: sobe como `internal`."""
    pcm = np.ascontiguousarray(samples.T, dtype=np.float32).tobytes()
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-nostdin", "-y",
            "-f", "f32le", "-ac", str(CHANNELS), "-ar", str(SAMPLE_RATE), "-i", "pipe:0",
            "-c:a", "aac", "-b:a", STEMS_BITRATE,
            "-f", "mp4", str(dst),
        ],
        input=pcm,
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
        raise RuntimeError("ffmpeg não conseguiu codificar a trilha em AAC")
