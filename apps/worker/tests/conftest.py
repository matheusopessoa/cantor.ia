import subprocess
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app import config, device, main
from app.audio import SAMPLE_RATE


@pytest.fixture(autouse=True)
def no_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """A suíte nunca usa a `OPENAI_API_KEY` do `.env` de dev (sdd-014): sem rede e sem gasto.
    Quem testa o provedor da OpenAI configura a chave falsa explicitamente. O device fica em
    `cpu` (sdd-016), para o resultado não depender da máquina; `test_device.py` testa o `auto`."""
    monkeypatch.setattr(config, "settings", lambda: config.Settings(OPENAI_API_KEY=None, WORKER_DEVICE="cpu"))
    monkeypatch.setattr(device, "_current", None)


def sine(freq_hz: float, seconds: float, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amp * np.sin(2 * np.pi * freq_hz * t)).astype(np.float32)


def glissando(f0: float, f1: float, seconds: float, amp: float = 0.5) -> np.ndarray:
    n = int(seconds * SAMPLE_RATE)
    freqs = np.geomspace(f0, f1, n)
    phase = 2 * np.pi * np.cumsum(freqs) / SAMPLE_RATE
    return (amp * np.sin(phase)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def white_noise(seconds: float, amp: float = 0.3, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return (amp * rng.standard_normal(int(seconds * SAMPLE_RATE))).astype(np.float32)


def write_wav(path: Path, mono: np.ndarray) -> Path:
    sf.write(path, mono, SAMPLE_RATE)
    return path


def write_encoded(path: Path, mono: np.ndarray, codec_args: list[str]) -> Path:
    """Grava WAV e converte com ffmpeg (ex.: m4a, webm) para simular o que o yt-dlp baixa."""
    wav = write_wav(path.with_suffix(".src.wav"), mono)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), *codec_args, str(path)], check=True)
    wav.unlink()
    return path


@pytest.fixture
def tmp_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Diretórios temporários das requisições ficam aqui, para checar a limpeza."""
    root = tmp_path / "requests"
    root.mkdir()
    counter = iter(range(10_000))

    def new_tmp_dir() -> Path:
        d = root / f"req-{next(counter)}"
        d.mkdir()
        return d

    monkeypatch.setattr(main, "_new_tmp_dir", new_tmp_dir)
    return root


@pytest.fixture
def client(tmp_root: Path) -> TestClient:
    # Sem `with`: o lifespan (que carrega o Demucs) não roda nos testes.
    return TestClient(main.app, raise_server_exceptions=False)


class FakeYoutubeDL:
    """Substitui yt_dlp.YoutubeDL. Configure pela classe antes de cada teste."""

    info: dict = {"duration": 3, "is_live": False, "live_status": "not_live"}
    raise_on_extract: Exception | None = None
    raise_on_download: Exception | None = None
    download_failures: list[Exception] = []   # levantadas uma por tentativa, antes de baixar
    audio: np.ndarray | None = None
    ext: str = "m4a"
    slow_steps: int = 0          # > 0: simula download lento chamando os progress_hooks
    search_entries: list[dict] = []   # resultados devolvidos por `ytsearchN:` (sdd-008)
    search_delay_s: float = 0.0       # > 0: simula busca lenta
    calls: list[str] = []
    options_seen: list[dict] = []     # opções de cada YoutubeDL criado
    finished: bool = False

    def __init__(self, options: dict):
        self.options = options
        FakeYoutubeDL.options_seen.append(options)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url: str, download: bool = False):
        FakeYoutubeDL.calls.append(url)
        if FakeYoutubeDL.raise_on_extract:
            raise FakeYoutubeDL.raise_on_extract
        if url.startswith("ytsearch"):
            if FakeYoutubeDL.search_delay_s:
                time.sleep(FakeYoutubeDL.search_delay_s)
            return {"_type": "playlist", "entries": [dict(e) for e in FakeYoutubeDL.search_entries]}
        return dict(FakeYoutubeDL.info)

    def process_ie_result(self, info: dict, download: bool = True):
        if FakeYoutubeDL.download_failures:
            raise FakeYoutubeDL.download_failures.pop(0)
        if FakeYoutubeDL.raise_on_download:
            raise FakeYoutubeDL.raise_on_download
        out = Path(self.options["outtmpl"].replace("%(ext)s", FakeYoutubeDL.ext))
        try:
            for _ in range(FakeYoutubeDL.slow_steps):
                time.sleep(0.1)
                for hook in self.options.get("progress_hooks", []):
                    hook({"status": "downloading"})
        finally:
            FakeYoutubeDL.finished = True
        # como o yt-dlp de verdade: recria o diretório de destino se ele sumiu
        out.parent.mkdir(parents=True, exist_ok=True)
        mono = FakeYoutubeDL.audio if FakeYoutubeDL.audio is not None else sine(440, 3)
        codec = {"m4a": ["-c:a", "aac"], "webm": ["-c:a", "libopus"]}[FakeYoutubeDL.ext]
        write_encoded(out, mono, codec)
        return info


@pytest.fixture
def fake_ytdl(monkeypatch: pytest.MonkeyPatch) -> type[FakeYoutubeDL]:
    FakeYoutubeDL.info = {"duration": 3, "is_live": False, "live_status": "not_live"}
    FakeYoutubeDL.raise_on_extract = None
    FakeYoutubeDL.raise_on_download = None
    FakeYoutubeDL.download_failures = []
    FakeYoutubeDL.audio = None
    FakeYoutubeDL.ext = "m4a"
    FakeYoutubeDL.slow_steps = 0
    FakeYoutubeDL.search_entries = []
    FakeYoutubeDL.search_delay_s = 0.0
    FakeYoutubeDL.calls = []
    FakeYoutubeDL.options_seen = []
    FakeYoutubeDL.finished = False
    monkeypatch.setattr("app.youtube.yt_dlp.YoutubeDL", FakeYoutubeDL)
    monkeypatch.setattr("app.youtube.RETRY_DELAYS_S", (0, 0))   # novas tentativas sem esperar
    return FakeYoutubeDL


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
