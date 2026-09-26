from pathlib import Path

from app.errors import STATUS_BY_CODE
from tests.conftest import silence, sine, write_wav


def post_file(client, path: Path, name: str | None = None):
    with path.open("rb") as f:
        return client.post(
            "/extract",
            files={"file": (name or path.name, f, "application/octet-stream")},
            data={"separate": "false"},
        )


def assert_tmp_clean(root: Path):
    leftovers = list(root.rglob("*"))
    assert leftovers == [], f"sobrou no tmp: {leftovers}"


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert set(response.json()["models"]) == {"demucs", "crepe"}


def test_extract_devolve_pitch_track(client, tmp_path, tmp_root):
    path = write_wav(tmp_path / "a.wav", sine(440, 3))
    response = post_file(client, path)
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1 and body["hopMs"] == 10
    assert abs(len(body["midi"]) - round(body["durationMs"] / 10)) <= 1
    assert_tmp_clean(tmp_root)


def test_extract_arquivo_grande_413(client, tmp_path, tmp_root):
    big = tmp_path / "big.mp3"
    big.write_bytes(b"\0" * (20 * 1024 * 1024 + 1))
    response = post_file(client, big)
    assert response.status_code == 413
    assert response.json()["error"] == "too_large"
    assert_tmp_clean(tmp_root)


def test_extract_texto_renomeado_415(client, tmp_path, tmp_root):
    fake = tmp_path / "nota.mp3"
    fake.write_text("isso não é áudio")
    response = post_file(client, fake)
    assert response.status_code == 415
    assert response.json()["error"] == "invalid_audio"
    assert_tmp_clean(tmp_root)


def test_extract_sem_arquivo_415(client):
    response = client.post("/extract", data={"separate": "false"})
    assert response.status_code == 415
    assert response.json()["error"] == "invalid_audio"


def test_extract_silencio_422(client, tmp_path, tmp_root):
    path = write_wav(tmp_path / "s.wav", silence(3))
    response = post_file(client, path)
    assert response.status_code == 422
    assert response.json()["error"] == "no_voice"
    assert_tmp_clean(tmp_root)


def test_extract_audio_longo_422(client, tmp_path, tmp_root, monkeypatch):
    monkeypatch.setattr("app.audio.MAX_DURATION_S", 2)
    path = write_wav(tmp_path / "longo.wav", sine(440, 3))
    response = post_file(client, path)
    assert response.status_code == 422
    assert response.json()["error"] == "too_long"
    assert_tmp_clean(tmp_root)


def test_erro_inesperado_vira_internal_500(client, tmp_path, tmp_root, monkeypatch):
    def boom(_):
        raise RuntimeError("detalhe interno")

    monkeypatch.setattr("app.pitch.track", boom)
    path = write_wav(tmp_path / "a.wav", sine(440, 3))
    response = post_file(client, path)
    assert response.status_code == 500
    assert response.json() == {"error": "internal", "message": "erro inesperado: RuntimeError"}
    assert "detalhe interno" not in response.text
    assert_tmp_clean(tmp_root)


def test_codigos_de_erro_tem_status_definido():
    assert STATUS_BY_CODE == {
        "too_large": 413,
        "invalid_audio": 415,
        "too_long": 422,
        "no_voice": 422,
        "invalid_video_id": 400,
        "video_unavailable": 422,
        "download_failed": 502,
        "internal": 500,
    }
