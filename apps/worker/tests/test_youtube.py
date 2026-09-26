import time

import httpx
import pytest
from yt_dlp.utils import DownloadError

from app import main
from app.youtube import canonical_url, validate_video_id
from tests.conftest import silence

VALID_ID = "dQw4w9WgXcQ"


@pytest.mark.parametrize("bad", ["abc", "../../etc/passwd", "https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQx", "dQw4w9WgXc!", ""])
def test_video_id_invalido_400_sem_chamar_ytdlp(client, fake_ytdl, bad):
    for route in ("/youtube/extract", "/youtube/audio"):
        response = client.post(route, json={"videoId": bad})
        assert response.status_code == 400
        assert response.json()["error"] == "invalid_video_id"
    assert fake_ytdl.calls == []


def test_corpo_sem_video_id_400(client, fake_ytdl):
    response = client.post("/youtube/extract", json={})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_video_id"
    assert fake_ytdl.calls == []


def test_url_canonica():
    assert canonical_url(VALID_ID) == f"https://www.youtube.com/watch?v={VALID_ID}"
    assert validate_video_id("a-b_c1234XY") == "a-b_c1234XY"


def test_youtube_extract_devolve_pitch_track(client, fake_ytdl, tmp_root):
    response = client.post("/youtube/extract", json={"videoId": VALID_ID, "separate": False})
    assert response.status_code == 200
    body = response.json()
    assert body["durationMs"] > 2900
    assert fake_ytdl.calls == [f"https://www.youtube.com/watch?v={VALID_ID}"]
    assert list(tmp_root.rglob("*")) == []


@pytest.mark.parametrize(
    ("info", "code"),
    [
        ({"duration": 200, "is_live": True}, "video_unavailable"),
        ({"duration": 200, "live_status": "is_upcoming"}, "video_unavailable"),
        ({"duration": 601, "is_live": False}, "too_long"),
    ],
)
def test_metadados_recusados_antes_de_baixar(client, fake_ytdl, tmp_root, info, code):
    fake_ytdl.info = info
    fake_ytdl.raise_on_download = AssertionError("não deveria baixar")
    response = client.post("/youtube/extract", json={"videoId": VALID_ID})
    assert response.status_code == 422
    assert response.json()["error"] == code
    assert list(tmp_root.rglob("*")) == []


@pytest.mark.parametrize(
    ("message", "status", "code"),
    [
        ("ERROR: [youtube] x: Video unavailable", 422, "video_unavailable"),
        ("ERROR: [youtube] x: Private video. Sign in if you've been granted access", 422, "video_unavailable"),
        ("ERROR: [youtube] x: Sign in to confirm your age", 422, "video_unavailable"),
        ("ERROR: unable to download video data: HTTP Error 403: Forbidden", 502, "download_failed"),
    ],
)
def test_erros_do_ytdlp_classificados(client, fake_ytdl, tmp_root, message, status, code):
    fake_ytdl.raise_on_extract = DownloadError(message)
    for route in ("/youtube/extract", "/youtube/audio"):
        response = client.post(route, json={"videoId": VALID_ID})
        assert response.status_code == status
        assert response.json()["error"] == code
    assert list(tmp_root.rglob("*")) == []


def test_youtube_extract_sem_voz_422(client, fake_ytdl, tmp_root):
    fake_ytdl.audio = silence(3)
    response = client.post("/youtube/extract", json={"videoId": VALID_ID, "separate": False})
    assert response.status_code == 422
    assert response.json()["error"] == "no_voice"
    assert list(tmp_root.rglob("*")) == []


def test_youtube_audio_m4a(client, fake_ytdl, tmp_root):
    response = client.post("/youtube/audio", json={"videoId": VALID_ID})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mp4"
    assert int(response.headers["content-length"]) == len(response.content) > 1000
    # a resposta inteira já foi lida: a limpeza em background já rodou
    assert list(tmp_root.rglob("*")) == []


def test_youtube_audio_webm_convertido_para_mp3(client, fake_ytdl, tmp_root):
    fake_ytdl.ext = "webm"
    response = client.post("/youtube/audio", json={"videoId": VALID_ID})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content[:3] == b"ID3" or response.content[:2] == b"\xff\xfb"
    assert list(tmp_root.rglob("*")) == []


@pytest.mark.anyio
async def test_audio_nao_espera_o_semaforo_da_extracao(fake_ytdl, tmp_root):
    await main._extraction_lock.acquire()   # simula uma extração longa em andamento
    try:
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://worker") as ac:
            response = await ac.post("/youtube/audio", json={"videoId": VALID_ID}, timeout=30)
            health = await ac.get("/health", timeout=5)
        assert response.status_code == 200
        assert health.status_code == 200
    finally:
        main._extraction_lock.release()


def test_timeout_do_download_cancela_e_nao_deixa_audio(client, fake_ytdl, tmp_root, monkeypatch):
    monkeypatch.setattr(main, "DOWNLOAD_TIMEOUT_S", 0.3)
    fake_ytdl.slow_steps = 30          # 3 s de "download" se ninguém cancelar
    started = time.perf_counter()
    response = client.post("/youtube/audio", json={"videoId": VALID_ID})
    assert response.status_code == 502
    assert response.json()["error"] == "download_failed"
    # a thread precisa parar pelo cancelamento (bem antes dos 3 s) e limpar o que criou
    deadline = time.perf_counter() + 5
    while not fake_ytdl.finished and time.perf_counter() < deadline:
        time.sleep(0.05)
    assert fake_ytdl.finished
    assert time.perf_counter() - started < 2
    time.sleep(0.2)                    # deixa o callback de limpeza rodar
    assert list(tmp_root.rglob("*")) == []


def test_youtube_audio_arquivo_existe_ate_o_fim_do_envio(client, fake_ytdl, tmp_root, monkeypatch):
    seen = []
    real_cleanup = main._cleanup

    def spy(tmp_dir):
        seen.append(sorted(p.name for p in tmp_dir.iterdir()))
        real_cleanup(tmp_dir)

    monkeypatch.setattr(main, "_cleanup", spy)
    response = client.post("/youtube/audio", json={"videoId": VALID_ID})
    assert response.status_code == 200
    assert seen == [["audio.m4a"]]     # a limpeza rodou uma vez, depois do envio, com o arquivo lá
    assert list(tmp_root.rglob("*")) == []


def test_arquivo_acima_do_limite_vira_too_large(client, fake_ytdl, tmp_root, monkeypatch):
    # o yt-dlp pula em silêncio quando passa do max_filesize: nenhum arquivo aparece
    monkeypatch.setattr(fake_ytdl, "process_ie_result", lambda self, info, download=True: info)
    response = client.post("/youtube/audio", json={"videoId": VALID_ID})
    assert response.status_code == 413
    assert response.json()["error"] == "too_large"


@pytest.mark.network
def test_download_real(client, tmp_root):
    # "Me at the zoo" (19 s), primeiro vídeo do YouTube: estável e curto.
    response = client.post("/youtube/audio", json={"videoId": "jNQXAC9IVRw"})
    assert response.status_code == 200
    assert response.headers["content-type"] in ("audio/mp4", "audio/mpeg")
