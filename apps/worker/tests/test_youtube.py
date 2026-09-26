import threading
import time

import httpx
import pytest
from yt_dlp.utils import DownloadError

from app import main, youtube
from app.errors import WorkerError
from app.youtube import canonical_url, validate_query, validate_video_id
from tests.conftest import silence

VALID_ID = "dQw4w9WgXcQ"

SEARCH_ENTRIES = [
    {
        "id": VALID_ID,
        "title": "Artista - Música (Official Audio)",
        "channel": "Artista - Topic",
        "duration": 213,
        "view_count": 1_200_000,
        "live_status": "not_live",
    },
    # sem canal (só uploader), sem duração e sem visualizações
    {"id": "a-b_c1234XY", "title": "  Artista Música  ", "uploader": "Canal Qualquer", "duration": None, "view_count": None},
    # ao vivo
    {"id": "AAAAAAAAAAA", "title": "Artista ao vivo", "channel": "Canal", "duration": 300.5, "view_count": 10, "live_status": "is_live"},
    # estreia marcada por is_live
    {"id": "BBBBBBBBBBB", "title": "Estreia", "channel": "Canal", "duration": 200, "view_count": 0, "is_live": True},
    # id inválido e sem título: descartados
    {"id": "curto", "title": "inválido", "duration": 100},
    {"id": "CCCCCCCCCCC", "title": "", "duration": 100},
    {"id": "DDDDDDDDDDD", "duration": 100},
]


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


# ── Novas tentativas do download ──────────────────────────────────────

FORBIDDEN = "ERROR: unable to download video data: HTTP Error 403: Forbidden"


def test_falha_passageira_e_tentada_de_novo(client, fake_ytdl, tmp_root, caplog):
    fake_ytdl.download_failures = [DownloadError(FORBIDDEN), DownloadError("ERROR: Sign in to confirm you're not a bot")]

    response = client.post("/youtube/audio", json={"videoId": VALID_ID})

    assert response.status_code == 200
    assert fake_ytdl.download_failures == []
    assert fake_ytdl.calls.count(youtube.canonical_url(VALID_ID)) == 3
    # a mensagem real do yt-dlp fica no log, com a tentativa
    assert "tentativa 1 de 3" in caplog.text and "403: Forbidden" in caplog.text
    assert "tentativa 2 de 3" in caplog.text and "not a bot" in caplog.text
    assert list(tmp_root.rglob("*")) == []


def test_tres_falhas_seguidas_viram_download_failed(client, fake_ytdl, tmp_root):
    fake_ytdl.download_failures = [DownloadError(FORBIDDEN)] * 3

    response = client.post("/youtube/extract", json={"videoId": VALID_ID, "separate": False})

    assert response.status_code == 502
    assert response.json()["error"] == "download_failed"
    assert fake_ytdl.calls.count(youtube.canonical_url(VALID_ID)) == 3
    assert list(tmp_root.rglob("*")) == []


@pytest.mark.parametrize(
    ("failure", "code"),
    [
        (DownloadError("ERROR: [youtube] x: Video unavailable"), "video_unavailable"),
        (DownloadError("ERROR: [youtube] x: Private video"), "video_unavailable"),
    ],
)
def test_erro_definitivo_nao_e_tentado_de_novo(client, fake_ytdl, tmp_root, failure, code):
    fake_ytdl.download_failures = [failure]

    response = client.post("/youtube/audio", json={"videoId": VALID_ID})

    assert response.json()["error"] == code
    assert fake_ytdl.calls.count(youtube.canonical_url(VALID_ID)) == 1


def test_video_longo_nao_e_tentado_de_novo(client, fake_ytdl, tmp_root):
    fake_ytdl.info = {"duration": 3_600, "is_live": False}

    response = client.post("/youtube/audio", json={"videoId": VALID_ID})

    assert response.json()["error"] == "too_long"
    assert len(fake_ytdl.calls) == 1


def test_nova_tentativa_apaga_o_que_a_anterior_deixou(tmp_path, fake_ytdl):
    (tmp_path / "audio.m4a.part").write_bytes(b"pela metade")
    fake_ytdl.download_failures = [DownloadError(FORBIDDEN)]

    path = youtube.download_audio(VALID_ID, tmp_path)

    assert path.name == "audio.m4a"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["audio.m4a"]


def test_cancelamento_corta_a_espera_e_nao_tenta_de_novo(tmp_path, fake_ytdl, monkeypatch):
    monkeypatch.setattr(youtube, "RETRY_DELAYS_S", (30, 30))
    fake_ytdl.download_failures = [DownloadError(FORBIDDEN)] * 3
    cancel = threading.Event()
    threading.Timer(0.2, cancel.set).start()
    started = time.perf_counter()

    with pytest.raises(WorkerError) as info:
        youtube.download_audio(VALID_ID, tmp_path, cancel)

    assert info.value.code == "download_failed" and "cancelado" in info.value.message
    assert time.perf_counter() - started < 5
    assert fake_ytdl.calls.count(youtube.canonical_url(VALID_ID)) == 1


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


# ── Busca (sdd-008) ───────────────────────────────────────────────────


def test_search_mapeia_os_campos_do_ytdlp(client, fake_ytdl, tmp_root):
    fake_ytdl.search_entries = SEARCH_ENTRIES
    response = client.post("/youtube/search", json={"query": "  Artista   Música "})
    assert response.status_code == 200
    assert response.json() == {
        "candidates": [
            {
                "videoId": VALID_ID,
                "title": "Artista - Música (Official Audio)",
                "channel": "Artista - Topic",
                "durationS": 213.0,
                "viewCount": 1_200_000,
                "isLive": False,
            },
            {
                "videoId": "a-b_c1234XY",
                "title": "Artista Música",
                "channel": "Canal Qualquer",
                "durationS": None,
                "viewCount": None,
                "isLive": False,
            },
            {
                "videoId": "AAAAAAAAAAA",
                "title": "Artista ao vivo",
                "channel": "Canal",
                "durationS": 300.5,
                "viewCount": 10,
                "isLive": True,
            },
            {"videoId": "BBBBBBBBBBB", "title": "Estreia", "channel": "Canal", "durationS": 200.0, "viewCount": 0, "isLive": True},
        ]
    }
    # espaços normalizados, 15 resultados, sem download nem arquivo no disco
    assert fake_ytdl.calls == ["ytsearch15:Artista Música"]
    assert fake_ytdl.options_seen[0]["extract_flat"] is True
    assert "outtmpl" not in fake_ytdl.options_seen[0]
    assert list(tmp_root.rglob("*")) == []


def test_search_sem_resultados_devolve_lista_vazia(client, fake_ytdl):
    response = client.post("/youtube/search", json={"query": "nada"})
    assert response.status_code == 200
    assert response.json() == {"candidates": []}


def test_search_limita_a_15_candidatos(client, fake_ytdl):
    fake_ytdl.search_entries = [
        {"id": f"{i:011d}", "title": f"v{i}", "channel": "c", "duration": 100, "view_count": i} for i in range(20)
    ]
    response = client.post("/youtube/search", json={"query": "muitos"})
    assert response.status_code == 200
    assert len(response.json()["candidates"]) == 15


@pytest.mark.parametrize("bad", ["", "   ", "x" * 201, None, 42])
def test_search_query_invalida_400_sem_chamar_ytdlp(client, fake_ytdl, bad):
    response = client.post("/youtube/search", json={"query": bad})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_query"
    assert fake_ytdl.calls == []


def test_search_corpo_sem_query_400(client, fake_ytdl):
    response = client.post("/youtube/search", json={})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_query"
    assert fake_ytdl.calls == []


def test_validate_query_normaliza_espacos():
    assert validate_query("  a   b ") == "a b"
    assert validate_query("x" * 200) == "x" * 200


@pytest.mark.parametrize(
    "exc",
    [DownloadError("ERROR: [youtube:search] Unable to download webpage"), RuntimeError("qualquer coisa")],
)
def test_search_falha_do_ytdlp_502(client, fake_ytdl, tmp_root, exc):
    fake_ytdl.raise_on_extract = exc
    response = client.post("/youtube/search", json={"query": "Artista Música"})
    assert response.status_code == 502
    assert response.json()["error"] == "search_failed"
    assert list(tmp_root.rglob("*")) == []


@pytest.mark.anyio
async def test_search_timeout_502(fake_ytdl, tmp_root, monkeypatch):
    # Assíncrono de propósito: o TestClient síncrono só devolve depois de fechar o loop, e o
    # fechamento espera a thread do dublê (1 s) terminar, o que esconderia o timeout de 0,2 s.
    monkeypatch.setattr(main, "SEARCH_TIMEOUT_S", 0.2)
    fake_ytdl.search_delay_s = 1.0
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://worker") as ac:
        started = time.perf_counter()
        response = await ac.post("/youtube/search", json={"query": "lenta"}, timeout=10)
        elapsed = time.perf_counter() - started
    assert response.status_code == 502
    assert response.json()["error"] == "search_failed"
    assert elapsed < 0.8   # respondeu no timeout, não quando o dublê terminou
    assert list(tmp_root.rglob("*")) == []


@pytest.mark.anyio
async def test_search_nao_espera_o_semaforo_da_extracao(fake_ytdl):
    fake_ytdl.search_entries = SEARCH_ENTRIES[:1]
    await main._extraction_lock.acquire()   # simula uma extração longa em andamento
    try:
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://worker") as ac:
            response = await ac.post("/youtube/search", json={"query": "Artista Música"}, timeout=10)
        assert response.status_code == 200
        assert response.json()["candidates"][0]["videoId"] == VALID_ID
    finally:
        main._extraction_lock.release()
