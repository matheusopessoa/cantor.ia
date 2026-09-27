"""Device dos modelos (sdd-016, Etapa B): `WORKER_DEVICE` → `app.device.resolve()`, usado pelo
Demucs (`separation.load`) e pelo MMS_FA (`alignment.load`/`emissions`); o `/health` diz qual é."""

import numpy as np
import pytest
import torch

from app import alignment, config, device, separation
from app.audio import SAMPLE_RATE


def settings_with(monkeypatch, **overrides):
    monkeypatch.setattr(config, "settings", lambda: config.Settings(OPENAI_API_KEY=None, **overrides))
    monkeypatch.setattr(device, "_current", None)


# ── config ────────────────────────────────────────────────────────────


@pytest.fixture
def clean_env(monkeypatch):
    monkeypatch.delenv("WORKER_DEVICE", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


def test_sem_variavel_e_auto(clean_env):
    assert config.Settings(_env_file=None).WORKER_DEVICE == "auto"


@pytest.mark.parametrize("value", ["", "  ", "auto", "AUTO", " cpu ", "MPS"])
def test_vazia_conta_como_auto_e_o_valor_e_normalizado(clean_env, monkeypatch, value):
    monkeypatch.setenv("WORKER_DEVICE", value)
    expected = value.strip().lower() or "auto"
    assert config.Settings(_env_file=None).WORKER_DEVICE == expected


@pytest.mark.parametrize("value", ["cuda", "gpu", "0"])
def test_fora_do_enum_e_erro_de_validacao(clean_env, monkeypatch, value):
    monkeypatch.setenv("WORKER_DEVICE", value)
    with pytest.raises(ValueError):
        config.Settings(_env_file=None)


# ── device.resolve ────────────────────────────────────────────────────


def test_auto_com_mps_disponivel_escolhe_mps(monkeypatch):
    settings_with(monkeypatch, WORKER_DEVICE="auto")
    monkeypatch.setattr(device, "_mps_available", lambda: True)
    assert device.resolve() == "mps"
    assert device.current() == "mps"


def test_auto_sem_mps_escolhe_cpu(monkeypatch):
    settings_with(monkeypatch, WORKER_DEVICE="auto")
    monkeypatch.setattr(device, "_mps_available", lambda: False)
    assert device.resolve() == "cpu"


def test_cpu_forcado_ignora_o_mps(monkeypatch):
    settings_with(monkeypatch, WORKER_DEVICE="cpu")
    monkeypatch.setattr(device, "_mps_available", lambda: True)
    assert device.resolve() == "cpu"


def test_mps_forcado_sem_mps_falha_alto(monkeypatch):
    settings_with(monkeypatch, WORKER_DEVICE="mps")
    monkeypatch.setattr(device, "_mps_available", lambda: False)
    with pytest.raises(RuntimeError, match="WORKER_DEVICE=mps"):
        device.resolve()
    assert device.current() is None


def test_resolve_e_fixo_depois_da_primeira_chamada(monkeypatch):
    settings_with(monkeypatch, WORKER_DEVICE="auto")
    monkeypatch.setattr(device, "_mps_available", lambda: True)
    assert device.resolve() == "mps"
    monkeypatch.setattr(device, "_mps_available", lambda: False)
    assert device.resolve() == "mps"


def test_current_e_none_antes_de_resolver():
    assert device.current() is None


# ── separation.load passa o device ao Separator ───────────────────────


def test_separation_load_cria_o_separator_no_device(monkeypatch):
    settings_with(monkeypatch, WORKER_DEVICE="auto")
    monkeypatch.setattr(device, "_mps_available", lambda: True)
    created: list[dict] = []

    class FakeSeparator:
        def __init__(self, **kwargs):
            created.append(kwargs)

    monkeypatch.setattr("demucs.api.Separator", FakeSeparator)
    monkeypatch.setattr(separation, "_separator", None)

    separation.load()
    separation.load()   # idempotente

    assert len(created) == 1
    assert created[0]["device"] == "mps"
    assert created[0]["model"] == separation.MODEL_NAME
    assert separation.is_loaded()


def test_separation_devolve_numpy_na_cpu_mesmo_com_tensores_de_outro_device(monkeypatch):
    """`.cpu()` antes do `.numpy()`: com o tensor já na CPU é um no-op, e o resto do pipeline
    (crepe, ffmpeg) nunca vê o device."""

    class Fake:
        def separate_tensor(self, wav, sr):
            return wav, {"vocals": wav * 0.5}

    monkeypatch.setattr(separation, "_separator", Fake())
    wav = np.stack([np.linspace(-1, 1, SAMPLE_RATE)] * 2).astype(np.float32)

    mono = separation.vocals(wav)
    vocals, instrumental = separation.stems(wav)

    assert isinstance(mono, np.ndarray) and mono.shape == (SAMPLE_RATE,)
    np.testing.assert_allclose(vocals + instrumental, wav, atol=1e-6)


# ── alignment: modelo e entrada no device, emissões na CPU ────────────


class FakeMmsFa(torch.nn.Module):
    """Registra o `.to()` e o device de cada entrada; devolve emissões (T, C) na entrada."""

    def __init__(self):
        super().__init__()
        self.moved_to: list[str] = []
        self.input_devices: list[str] = []

    def to(self, target):  # type: ignore[override]
        self.moved_to.append(str(target))
        return self

    def forward(self, wav: torch.Tensor):
        self.input_devices.append(str(wav.device))
        frames = max(1, wav.shape[-1] // 320)
        return torch.zeros(1, frames, len(alignment._DICTIONARY), device=wav.device), None


def test_alignment_load_move_o_modelo_para_o_device(monkeypatch):
    settings_with(monkeypatch, WORKER_DEVICE="auto")
    monkeypatch.setattr(device, "_mps_available", lambda: True)
    fake = FakeMmsFa()
    monkeypatch.setattr(alignment.MMS_FA, "get_model", lambda with_star: fake)
    monkeypatch.setattr(alignment, "_model", None)

    alignment.load()

    assert fake.moved_to == ["mps"]
    assert alignment.is_loaded()


def test_emissions_manda_a_entrada_ao_device_e_devolve_na_cpu(monkeypatch):
    # Em CPU (o único device que a suíte tem): o contrato é o mesmo, a entrada vai para
    # `device.resolve()` e as emissões voltam para a CPU.
    fake = FakeMmsFa()
    monkeypatch.setattr(alignment, "_model", fake)
    mono = np.zeros(SAMPLE_RATE * 2, dtype=np.float32)

    log_probs = alignment.emissions(mono)

    assert device.resolve() == "cpu"
    assert fake.input_devices and all(d == "cpu" for d in fake.input_devices)
    assert str(log_probs.device) == "cpu"
    assert log_probs.shape[1] == len(alignment._DICTIONARY)


# ── /health ───────────────────────────────────────────────────────────


def test_health_diz_o_device(client):
    assert client.get("/health").json()["device"] is None   # o lifespan não roda no TestClient sem `with`
    device.resolve()
    assert client.get("/health").json()["device"] == "cpu"


def test_boot_resolve_o_device_antes_dos_modelos(monkeypatch, tmp_root):
    from fastapi.testclient import TestClient

    from app import main

    order: list[str] = []
    for module in ("separation", "pitch", "alignment", "transcription"):
        monkeypatch.setattr(f"app.{module}.load", lambda module=module: order.append(module))
    settings_with(monkeypatch, WORKER_DEVICE="mps")
    monkeypatch.setattr(device, "_mps_available", lambda: False)

    with pytest.raises(RuntimeError, match="WORKER_DEVICE=mps"):
        with TestClient(main.app):
            pass
    assert order == []   # nenhum peso carregado: o boot morreu no device
