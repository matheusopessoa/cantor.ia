"""Isolamento da voz com Demucs htdemucs (stem `vocals`)."""

import numpy as np
import torch

from app.audio import SAMPLE_RATE

MODEL_NAME = "htdemucs"

_separator = None


def load() -> None:
    """Carrega o modelo uma vez (lifespan do FastAPI). Baixa os pesos na primeira execução."""
    global _separator
    if _separator is None:
        from demucs.api import Separator

        _separator = Separator(model=MODEL_NAME, device="cpu", progress=False)


def is_loaded() -> bool:
    return _separator is not None


def vocals(wav: np.ndarray) -> np.ndarray:
    """Recebe (2, amostras) a 44.1 kHz e devolve a voz isolada em mono (amostras,)."""
    load()
    assert _separator is not None
    with torch.no_grad():
        _, stems = _separator.separate_tensor(torch.from_numpy(wav), SAMPLE_RATE)
    return stems["vocals"].mean(dim=0).numpy().astype(np.float32)
