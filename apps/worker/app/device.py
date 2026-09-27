"""Device dos modelos pesados (sdd-016, Etapa B): o Demucs e o MMS_FA rodam na GPU do Mac
(`mps`) quando ela existe; o crepe (modelo `tiny`, sem ganho medido em GPU) e o Whisper local
(ctranslate2, sem MPS) ficam sempre em CPU.

`WORKER_DEVICE` (`app/config.py`): `auto` (padrão) escolhe `mps` se
`torch.backends.mps.is_available()`, senão `cpu`; `cpu` ou `mps` forçam. `mps` forçado numa
máquina sem MPS é erro no boot, não silêncio: quem pediu quer saber. Resolvido uma vez por
processo; os resultados dos modelos voltam para a CPU (`.cpu()`) antes de virar `numpy`, então o
resto do pipeline não sabe do device.
"""

import logging

import torch

from app import config

log = logging.getLogger(__name__)

_current: str | None = None


def _mps_available() -> bool:
    return bool(torch.backends.mps.is_available())


def _pick(wanted: str) -> str:
    available = _mps_available()
    if wanted == "auto":
        return "mps" if available else "cpu"
    if wanted == "mps" and not available:
        raise RuntimeError("WORKER_DEVICE=mps, mas o MPS não está disponível neste torch/máquina (use auto ou cpu)")
    return wanted


def resolve() -> str:
    """O device dos modelos (`"cpu"` ou `"mps"`), resolvido na primeira chamada e fixo depois."""
    global _current
    if _current is None:
        _current = _pick(config.settings().WORKER_DEVICE)
        log.info("device dos modelos (Demucs, MMS_FA): %s", _current)
    return _current


def current() -> str | None:
    """O device já resolvido, ou `None` antes do primeiro `resolve()` (para o `/health` não forçar nada)."""
    return _current
