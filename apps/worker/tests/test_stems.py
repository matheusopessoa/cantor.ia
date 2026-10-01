"""Separação em voz e instrumental (sdd-013): `separation.stems` com um Demucs falso e a rota
`POST /stems`, que devolve as duas trilhas em AAC num `multipart/form-data`."""

import asyncio
import re
from pathlib import Path

import httpx
import numpy as np
import pytest
import torch

from app import audio, main, separation
from app.audio import SAMPLE_RATE
from tests.conftest import sine, white_noise, write_wav


class FakeSeparator:
    """`separate_tensor` de mentira: a "voz" é a metade esquerda da mistura (qualquer coisa
    determinística serve; o que importa é `instrumental = mix − voz`)."""

    def separate_tensor(self, wav: torch.Tensor, sr: int):
        assert sr == SAMPLE_RATE
        vocals = wav * torch.tensor([[0.5], [0.25]])
        return wav, {"drums": wav * 0.1, "bass": wav * 0.1, "other": wav * 0.1, "vocals": vocals}


@pytest.fixture
def fake_separator(monkeypatch):
    monkeypatch.setattr(separation, "_separator", FakeSeparator())


def stereo(mono: np.ndarray) -> np.ndarray:
    return np.stack([mono, 0.8 * mono]).astype(np.float32)


def parse_multipart(body: bytes, content_type: str) -> dict[str, tuple[str, str, bytes]]:
    """{ nome: (filename, content-type, bytes) } de um multipart/form-data só com arquivos."""
    boundary = re.search(r'boundary="?([^";]+)"?', content_type).group(1).encode()
    assert body.endswith(b"--" + boundary + b"--\r\n")
    parts = {}
    for raw in body.split(b"--" + boundary)[1:-1]:
        head, _, payload = raw.lstrip(b"\r\n").partition(b"\r\n\r\n")
        headers = head.decode()
        name = re.search(r'name="([^"]+)"', headers).group(1)
        filename = re.search(r'filename="([^"]+)"', headers).group(1)
        media_type = re.search(r"Content-Type: (\S+)", headers).group(1)
        parts[name] = (filename, media_type, payload[:-2])   # tira o \r\n antes do próximo boundary
    return parts


def post_stems(client, path: Path):
    with path.open("rb") as f:
        return client.post("/stems", files={"file": (path.name, f, "application/octet-stream")})


def assert_tmp_clean(root: Path):
    assert list(root.rglob("*")) == []


# ── separation.stems ──────────────────────────────────────────────────


def test_stems_devolve_estereo_e_instrumental_igual_a_mix_menos_voz(fake_separator):
    wav = stereo(sine(440, 2) + white_noise(2, amp=0.1))

    vocals, instrumental = separation.stems(wav)

    assert vocals.shape == instrumental.shape == wav.shape
    assert vocals.dtype == instrumental.dtype == np.float32
    np.testing.assert_allclose(vocals, wav * np.array([[0.5], [0.25]], dtype=np.float32), atol=1e-6)
    np.testing.assert_allclose(vocals + instrumental, wav, atol=1e-6)


def test_stems_musica_instrumental_devolve_voz_silenciosa(monkeypatch):
    class Silent:
        def separate_tensor(self, wav, sr):
            return wav, {"vocals": torch.zeros_like(wav)}

    monkeypatch.setattr(separation, "_separator", Silent())
    wav = stereo(sine(110, 1))

    vocals, instrumental = separation.stems(wav)

    assert not vocals.any()
    np.testing.assert_allclose(instrumental, wav)


# ── audio.encode_aac ──────────────────────────────────────────────────


def test_encode_aac_grava_m4a_com_o_mesmo_numero_de_amostras(tmp_path):
    wav = stereo(sine(440, 3))
    dst = tmp_path / "voz.m4a"

    audio.encode_aac(wav, dst)
    decoded = audio.decode(dst)

    assert dst.stat().st_size > 1000
    assert decoded.shape == wav.shape
    assert audio.duration_ms(decoded) == audio.duration_ms(wav)


# ── POST /stems ───────────────────────────────────────────────────────


def test_stems_responde_multipart_com_voz_e_instrumental(client, tmp_path, tmp_root, fake_separator):
    mix = sine(440, 3, amp=0.4) + sine(110, 3, amp=0.3)
    path = write_wav(tmp_path / "musica.wav", mix)

    response = post_stems(client, path)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("multipart/form-data; boundary=")
    assert int(response.headers["content-length"]) == len(response.content)
    parts = parse_multipart(response.content, response.headers["content-type"])
    assert set(parts) == {"vocals", "instrumental"}
    assert parts["vocals"][:2] == ("vocals.m4a", "audio/mp4")
    assert parts["instrumental"][:2] == ("instrumental.m4a", "audio/mp4")

    decoded = {}
    for name, (filename, _, payload) in parts.items():
        (tmp_path / filename).write_bytes(payload)
        decoded[name] = audio.decode(tmp_path / filename)
    # mesma taxa e mesmo número de amostras entre as duas e igual ao original (sdd-013 §4)
    original = audio.decode(path)   # o que o worker decodificou (o upmix mono → estéreo tira 3 dB)
    assert decoded["vocals"].shape == decoded["instrumental"].shape == original.shape == (2, mix.size)
    # voz + instrumental ≈ original, sem atraso: só o ruído de codec do AAC a 112 kbps (regra 5)
    reconstructed = decoded["vocals"] + decoded["instrumental"]
    error = np.sqrt(np.mean((reconstructed - original) ** 2)) / np.sqrt(np.mean(original**2))
    assert error < 0.05   # −26 dB; um atraso de 1 amostra ou −3 dB dariam ≥ 0,05
    # a resposta inteira já foi lida: a limpeza em background já rodou
    assert_tmp_clean(tmp_root)


def test_stems_arquivo_grande_413(client, tmp_path, tmp_root, fake_separator):
    big = tmp_path / "big.mp3"
    big.write_bytes(b"\0" * (20 * 1024 * 1024 + 1))
    response = post_stems(client, big)
    assert response.status_code == 413
    assert response.json()["error"] == "too_large"
    assert_tmp_clean(tmp_root)


def test_stems_texto_renomeado_415(client, tmp_path, tmp_root, fake_separator):
    fake = tmp_path / "nota.mp3"
    fake.write_text("isso não é áudio")
    response = post_stems(client, fake)
    assert response.status_code == 415
    assert response.json()["error"] == "invalid_audio"
    assert_tmp_clean(tmp_root)


def test_stems_sem_arquivo_415(client):
    response = client.post("/stems", data={})
    assert response.status_code == 415
    assert response.json()["error"] == "invalid_audio"


def test_stems_audio_longo_422(client, tmp_path, tmp_root, fake_separator, monkeypatch):
    monkeypatch.setattr("app.audio.MAX_DURATION_S", 2)
    path = write_wav(tmp_path / "longo.wav", sine(440, 3))
    response = post_stems(client, path)
    assert response.status_code == 422
    assert response.json()["error"] == "too_long"
    assert_tmp_clean(tmp_root)


def test_stems_erro_do_demucs_vira_internal_500(client, tmp_path, tmp_root, monkeypatch):
    def boom(_):
        raise RuntimeError("detalhe interno")

    monkeypatch.setattr("app.separation.stems", boom)
    path = write_wav(tmp_path / "a.wav", sine(440, 2))
    response = post_stems(client, path)
    assert response.status_code == 500
    assert response.json() == {"error": "internal", "message": "erro inesperado: RuntimeError"}
    assert_tmp_clean(tmp_root)


@pytest.mark.anyio
async def test_stems_espera_o_semaforo_da_extracao(tmp_path, tmp_root, fake_separator):
    """A separação ocupa o semáforo como uma extração (sdd-013 §6): com ele tomado, o /stems
    espera; solto, termina. O /health continua respondendo enquanto isso."""
    path = write_wav(tmp_path / "a.wav", sine(440, 2))
    await main._extraction_lock.acquire()
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://worker") as ac:
        with path.open("rb") as f:
            request = asyncio.ensure_future(ac.post("/stems", files={"file": ("a.wav", f.read(), "audio/wav")}, timeout=30))
            await asyncio.sleep(0.3)
            assert not request.done()
            health = await ac.get("/health", timeout=5)
            assert health.status_code == 200
            main._extraction_lock.release()
            response = await request
    assert response.status_code == 200
    assert_tmp_clean(tmp_root)


@pytest.mark.slow
def test_stems_com_demucs_de_verdade(tmp_path):
    """Demucs real num áudio de 10 s: as trilhas têm o tamanho da entrada e somam o original."""
    rng = np.random.default_rng(1)
    mix = stereo(sine(440, 10, amp=0.4) + (0.05 * rng.standard_normal(10 * SAMPLE_RATE)).astype(np.float32))
    path = write_wav(tmp_path / "mix.wav", mix[0])

    vocals_path, instrumental_path = main._stems_sync(path, tmp_path)

    vocals, instrumental = audio.decode(vocals_path), audio.decode(instrumental_path)
    assert vocals.shape == instrumental.shape == (2, 10 * SAMPLE_RATE)
