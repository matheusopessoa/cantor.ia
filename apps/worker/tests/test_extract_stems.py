"""Trilhas na preparação (sdd-016, Etapa A): `/extract` e `/youtube/extract` com `stems=true`
rodam o Demucs UMA vez (`separation.stems`), tiram a voz mono dele para o crepe e o alinhador
e devolvem `multipart/form-data` com `result` (o mesmo JSON de sempre), `vocals` e
`instrumental` (AAC). Sem `stems`, ou com `separate=false`, JSON como antes."""

import json
import re
from pathlib import Path

import numpy as np
import pytest
import torch

from app import audio, separation
from tests.conftest import silence, sine, write_wav


class CountingSeparator:
    """`separate_tensor` de mentira que conta as chamadas: a "voz" é a mistura pela metade."""

    calls = 0

    def separate_tensor(self, wav: torch.Tensor, sr: int):
        CountingSeparator.calls += 1
        return wav, {"vocals": wav * 0.5}


@pytest.fixture
def counting_separator(monkeypatch):
    CountingSeparator.calls = 0
    monkeypatch.setattr(separation, "_separator", CountingSeparator())
    # `separation.vocals` não pode ser chamado com `stems`: seria o segundo Demucs.
    monkeypatch.setattr(separation, "vocals", lambda wav: (_ for _ in ()).throw(AssertionError("separation.vocals chamado")))
    return CountingSeparator


def parse_multipart(body: bytes, content_type: str) -> dict[str, tuple[str | None, str, bytes]]:
    """{ nome: (filename ou None, content-type, bytes) } de um multipart/form-data."""
    boundary = re.search(r'boundary="?([^";]+)"?', content_type).group(1).encode()
    assert body.endswith(b"--" + boundary + b"--\r\n")
    parts = {}
    for raw in body.split(b"--" + boundary)[1:-1]:
        head, _, payload = raw.lstrip(b"\r\n").partition(b"\r\n\r\n")
        headers = head.decode()
        name = re.search(r'name="([^"]+)"', headers).group(1)
        filename = re.search(r'filename="([^"]+)"', headers)
        media_type = re.search(r"Content-Type: (\S+)", headers).group(1)
        parts[name] = (filename.group(1) if filename else None, media_type, payload[:-2])
    return parts


def post_extract(client, path: Path, **data):
    with path.open("rb") as f:
        return client.post("/extract", files={"file": (path.name, f, "application/octet-stream")}, data=data)


def assert_tmp_clean(root: Path):
    assert list(root.rglob("*")) == []


def assert_stems_response(response, tmp_path: Path, expected_samples: int):
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("multipart/form-data; boundary=")
    assert int(response.headers["content-length"]) == len(response.content)
    parts = parse_multipart(response.content, response.headers["content-type"])
    assert list(parts) == ["result", "vocals", "instrumental"]
    assert parts["result"][:2] == (None, "application/json")
    assert parts["vocals"][:2] == ("vocals.m4a", "audio/mp4")
    assert parts["instrumental"][:2] == ("instrumental.m4a", "audio/mp4")
    result = json.loads(parts["result"][2])
    assert result["version"] == 1 and result["hopMs"] == 10
    assert abs(len(result["midi"]) - round(result["durationMs"] / 10)) <= 1
    for name in ("vocals", "instrumental"):
        (tmp_path / f"{name}.m4a").write_bytes(parts[name][2])
        decoded = audio.decode(tmp_path / f"{name}.m4a")
        assert decoded.shape == (2, expected_samples)
    return result


# ── /extract ──────────────────────────────────────────────────────────


def test_extract_com_stems_responde_multipart_com_um_demucs_so(client, tmp_path, tmp_root, counting_separator):
    mono = sine(440, 3, amp=0.4)
    path = write_wav(tmp_path / "musica.wav", mono)

    response = post_extract(client, path, stems="true")

    assert_stems_response(response, tmp_path, mono.size)
    assert counting_separator.calls == 1
    assert_tmp_clean(tmp_root)   # a resposta inteira foi lida: a limpeza em background já rodou


def test_extract_sem_stems_continua_json_e_usa_separation_vocals(client, tmp_path, tmp_root, monkeypatch):
    monkeypatch.setattr(separation, "_separator", CountingSeparator())
    called: list[str] = []
    real_vocals = separation.vocals
    monkeypatch.setattr(separation, "vocals", lambda wav: (called.append("vocals"), real_vocals(wav))[1])
    monkeypatch.setattr(separation, "stems", lambda wav: (_ for _ in ()).throw(AssertionError("separation.stems chamado")))
    path = write_wav(tmp_path / "musica.wav", sine(440, 2))

    response = post_extract(client, path)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["hopMs"] == 10
    assert called == ["vocals"]
    assert_tmp_clean(tmp_root)


def test_extract_stems_com_separate_false_e_json(client, tmp_path, tmp_root, monkeypatch):
    monkeypatch.setattr(separation, "stems", lambda wav: (_ for _ in ()).throw(AssertionError("Demucs chamado")))
    path = write_wav(tmp_path / "musica.wav", sine(440, 2))

    response = post_extract(client, path, stems="true", separate="false")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert_tmp_clean(tmp_root)


def test_extract_stems_com_a_letra_alinha_sobre_a_mesma_voz(client, tmp_path, tmp_root, counting_separator, monkeypatch):
    received: list = []

    def align(mono, lines):
        received.append((mono.shape, lines))
        return None

    monkeypatch.setattr("app.alignment.align", align)
    mono = sine(440, 2)
    path = write_wav(tmp_path / "musica.wav", mono)

    response = post_extract(client, path, stems="true", lyrics=json.dumps([{"text": "la la", "startMs": 0}]))

    result = assert_stems_response(response, tmp_path, mono.size)
    assert result["alignment"] is None
    assert received and received[0][0] == (mono.size,)   # a voz mono do MESMO Demucs
    assert counting_separator.calls == 1


def test_extract_stems_sem_voz_e_json_de_erro_e_tmp_limpo(client, tmp_path, tmp_root, counting_separator):
    path = write_wav(tmp_path / "s.wav", silence(3))

    response = post_extract(client, path, stems="true")

    assert response.status_code == 422
    assert response.json()["error"] == "no_voice"
    assert_tmp_clean(tmp_root)


def test_extract_stems_audio_longo_e_json_de_erro_e_tmp_limpo(client, tmp_path, tmp_root, counting_separator, monkeypatch):
    monkeypatch.setattr("app.audio.MAX_DURATION_S", 2)
    path = write_wav(tmp_path / "longo.wav", sine(440, 3))

    response = post_extract(client, path, stems="true")

    assert response.status_code == 422
    assert response.json()["error"] == "too_long"
    assert counting_separator.calls == 0
    assert_tmp_clean(tmp_root)


# ── /youtube/extract ──────────────────────────────────────────────────


def test_youtube_extract_com_stems_responde_multipart(client, fake_ytdl, tmp_path, tmp_root, counting_separator):
    fake_ytdl.audio = sine(440, 3, amp=0.4)

    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "stems": True})

    assert_stems_response(response, tmp_path, fake_ytdl.audio.size)
    assert counting_separator.calls == 1
    assert_tmp_clean(tmp_root)


def test_youtube_extract_sem_stems_continua_json(client, fake_ytdl, tmp_root, monkeypatch):
    monkeypatch.setattr(separation, "_separator", CountingSeparator())

    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["hopMs"] == 10
    assert_tmp_clean(tmp_root)


def test_youtube_extract_stems_com_download_que_falha_e_json_de_erro(client, fake_ytdl, tmp_root, counting_separator):
    from app.errors import WorkerError

    fake_ytdl.raise_on_extract = WorkerError("video_unavailable", "privado")

    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "stems": True})

    assert response.status_code == 422
    assert response.json()["error"] == "video_unavailable"
    assert counting_separator.calls == 0
    assert_tmp_clean(tmp_root)


def test_instrumental_e_mix_menos_voz_tambem_na_extracao(tmp_path, counting_separator):
    """A voz mono do crepe é a média do MESMO stem que vira a trilha de voz (sdd-016 §1)."""
    from app import main

    mono = sine(440, 2, amp=0.4)
    path = write_wav(tmp_path / "musica.wav", mono)

    result, stems = main._extract_sync(path, separate=True, stems=True)

    assert stems is not None and all(p.exists() for p in stems)
    vocals, instrumental = audio.decode(stems[0]), audio.decode(stems[1])
    original = audio.decode(path)
    error = np.sqrt(np.mean((vocals + instrumental - original) ** 2)) / np.sqrt(np.mean(original**2))
    assert error < 0.05
    assert abs(len(result.midi) - round(result.durationMs / 10)) <= 1
