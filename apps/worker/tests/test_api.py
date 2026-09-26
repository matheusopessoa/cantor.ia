import json
from pathlib import Path

import pytest

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
    assert set(response.json()["models"]) == {"demucs", "crepe", "mms_fa", "whisper"}


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
        "invalid_lyrics": 400,
        "invalid_query": 400,
        "search_failed": 502,
        "internal": 500,
    }


# ── Alinhamento da letra (sdd-010) ────────────────────────────────────

LYRICS = [{"text": "Olá mundo", "startMs": 500}, {"text": "", "startMs": 1_500}, {"text": "Tudo bem", "startMs": 2_000}]


def fake_alignment(lines):
    from app.schemas import Alignment, LineAlignment

    return Alignment(
        lines=[
            LineAlignment(index=i, startMs=None if not l.text else 100 * i, endMs=None if not l.text else 100 * i + 50, score=None if not l.text else 0.9)
            for i, l in enumerate(lines)
        ]
    )


@pytest.fixture
def fake_aligner(monkeypatch):
    """Sem modelo: `align` devolve um alinhamento fabricado e registra a letra recebida."""
    received: list = []

    def align(mono, lines):
        received.append(lines)
        return fake_alignment(lines)

    monkeypatch.setattr("app.alignment.align", align)
    monkeypatch.setattr("app.alignment.is_loaded", lambda: True)
    return received


def test_health_diz_se_o_mms_fa_esta_carregado(client, monkeypatch):
    monkeypatch.setattr("app.alignment.is_loaded", lambda: True)
    assert client.get("/health").json()["models"]["mms_fa"] is True
    monkeypatch.setattr("app.alignment.is_loaded", lambda: False)
    assert client.get("/health").json()["models"]["mms_fa"] is False


def test_extract_sem_lyrics_devolve_alignment_null_e_nao_chama_o_alinhador(client, tmp_path, tmp_root, fake_aligner):
    path = write_wav(tmp_path / "a.wav", sine(440, 3))
    body = post_file(client, path).json()
    assert body["alignment"] is None
    assert set(body) == {"version", "hopMs", "durationMs", "midi", "alignment", "lyrics", "transcript"}
    assert body["lyrics"] is None
    assert body["transcript"] is None
    assert fake_aligner == []
    assert_tmp_clean(tmp_root)


def test_extract_com_lyrics_devolve_alignment_na_ordem(client, tmp_path, tmp_root, fake_aligner):
    path = write_wav(tmp_path / "a.wav", sine(440, 3))
    with path.open("rb") as f:
        response = client.post(
            "/extract",
            files={"file": (path.name, f, "application/octet-stream")},
            data={"separate": "false", "lyrics": json.dumps(LYRICS)},
        )
    assert response.status_code == 200
    alignment = response.json()["alignment"]
    assert alignment["version"] == 1 and alignment["model"] == "mms_fa" and alignment["frameMs"] == 20
    assert [l["index"] for l in alignment["lines"]] == [0, 1, 2]
    assert alignment["lines"][1] == {"index": 1, "startMs": None, "endMs": None, "score": None}
    assert alignment["lines"][2]["startMs"] == 200
    assert [(l.text, l.startMs) for l in fake_aligner[0]] == [(l["text"], l["startMs"]) for l in LYRICS]
    assert_tmp_clean(tmp_root)


@pytest.mark.parametrize("bad", ["nao é json", '{"text": "objeto"}', '[{"startMs": 1}]', '[{"text": 5}]'])
def test_extract_lyrics_malformado_400_invalid_lyrics(client, tmp_path, tmp_root, fake_aligner, bad):
    path = write_wav(tmp_path / "a.wav", sine(440, 3))
    with path.open("rb") as f:
        response = client.post(
            "/extract",
            files={"file": (path.name, f, "application/octet-stream")},
            data={"separate": "false", "lyrics": bad},
        )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_lyrics"
    assert fake_aligner == []
    assert_tmp_clean(tmp_root)


def test_youtube_extract_com_lyrics_devolve_alignment(client, fake_ytdl, tmp_root, fake_aligner):
    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "separate": False, "lyrics": LYRICS})
    assert response.status_code == 200
    assert [l["startMs"] for l in response.json()["alignment"]["lines"]] == [0, None, 200]
    assert list(tmp_root.rglob("*")) == []


def test_youtube_extract_sem_lyrics_devolve_alignment_null(client, fake_ytdl, tmp_root, fake_aligner):
    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "separate": False})
    assert response.status_code == 200
    assert response.json()["alignment"] is None
    assert fake_aligner == []


def test_youtube_extract_lyrics_malformado_400_invalid_lyrics(client, fake_ytdl, fake_aligner):
    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "lyrics": [{"startMs": 1}]})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_lyrics"
    assert fake_ytdl.calls == []


def test_alinhador_devolvendo_none_nao_derruba_a_extracao(client, tmp_path, tmp_root, monkeypatch):
    monkeypatch.setattr("app.alignment.align", lambda mono, lines: None)
    path = write_wav(tmp_path / "a.wav", sine(440, 3))
    with path.open("rb") as f:
        response = client.post(
            "/extract",
            files={"file": (path.name, f, "application/octet-stream")},
            data={"separate": "false", "lyrics": json.dumps(LYRICS)},
        )
    assert response.status_code == 200
    assert response.json()["alignment"] is None
    assert len(response.json()["midi"]) > 0


# ── Escolha da letra entre candidatas (sdd-011) ───────────────────────

CANDIDATES = [
    {"source": "lrclib", "lines": [{"text": "outra música inteira", "startMs": 100}]},
    {"source": "ytmusic", "lines": [{"text": "Olá mundo"}, {"text": "Tudo bem"}]},
]


def fake_transcript(*pairs):
    from app.transcription import Transcript, Word

    return Transcript(words=[Word(text=t, startMs=s, endMs=s + 200, probability=0.9) for t, s in pairs], language="pt")


@pytest.fixture
def fake_whisper(monkeypatch):
    """Sem modelo: `transcribe` devolve a transcrição configurada e registra o prompt."""
    state = {"transcript": fake_transcript(("olá", 300), ("mundo", 600), ("tudo", 1500), ("bem", 1800)), "prompts": [], "languages": [], "error": None}

    def transcribe(mono, prompt=None, tmp_dir=None, language=None):
        state["prompts"].append(prompt)
        state["languages"].append(language)
        if state["error"]:
            raise state["error"]
        return state["transcript"]

    monkeypatch.setattr("app.transcription.transcribe", transcribe)
    monkeypatch.setattr("app.transcription.is_loaded", lambda: True)
    return state


def test_a_lingua_da_letra_das_candidatas_vai_para_o_whisper(client, fake_ytdl, tmp_root, fake_aligner, fake_whisper):
    letra = [{"text": t} for t in ("Eu não sei mais o que fazer com você", "Meu coração já tá cansado de tudo", "Isso é tudo que eu vou dizer pra ela")]
    client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "separate": False, "lyricsCandidates": [{"source": "ytmusic", "lines": letra}]})
    client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "separate": False, "lyricsCandidates": []})
    assert fake_whisper["languages"] == ["pt", None]


def test_health_diz_se_o_whisper_esta_carregado(client, monkeypatch):
    monkeypatch.setattr("app.transcription.is_loaded", lambda: True)
    assert client.get("/health").json()["models"]["whisper"] is True


# ── Transcrição pela OpenAI (sdd-014) ─────────────────────────────────


def with_openai_key(monkeypatch):
    from pydantic import SecretStr

    from app import config

    monkeypatch.setattr(config, "settings", lambda: config.Settings(OPENAI_API_KEY=SecretStr("sk-test-not-a-real-key")))


def test_health_diz_o_provedor_da_transcricao(client, monkeypatch):
    assert client.get("/health").json()["transcription"] == "local"
    with_openai_key(monkeypatch)
    assert client.get("/health").json()["transcription"] == "openai"


@pytest.fixture
def boot_loads(monkeypatch):
    """O que o lifespan carrega, sem modelo nenhum."""
    loaded: list[str] = []
    for module in ("separation", "pitch", "alignment", "transcription"):
        monkeypatch.setattr(f"app.{module}.load", lambda module=module: loaded.append(module))
    return loaded


def test_com_chave_o_boot_nao_carrega_o_whisper_local(monkeypatch, boot_loads, tmp_root):
    from fastapi.testclient import TestClient

    from app import main

    with_openai_key(monkeypatch)
    with TestClient(main.app) as client:
        body = client.get("/health").json()
    assert boot_loads == ["separation", "pitch", "alignment"]
    assert body["transcription"] == "openai"


def test_sem_chave_o_boot_carrega_o_whisper_local(boot_loads, tmp_root):
    from fastapi.testclient import TestClient

    from app import main

    with TestClient(main.app):
        pass
    assert boot_loads == ["separation", "pitch", "alignment", "transcription"]


def test_extracao_manda_o_tmp_da_requisicao_para_a_transcricao(client, fake_ytdl, tmp_root, fake_aligner, fake_whisper, monkeypatch):
    received = []

    def transcribe(mono, prompt=None, tmp_dir=None, language=None):
        received.append(tmp_dir)
        return fake_whisper["transcript"]

    monkeypatch.setattr("app.transcription.transcribe", transcribe)
    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "separate": False, "lyricsCandidates": CANDIDATES})

    assert response.status_code == 200
    assert received[0] is not None and received[0].parent == tmp_root
    assert list(tmp_root.rglob("*")) == []


def test_youtube_extract_com_candidatas_escolhe_a_letra_e_alinha_ela(client, fake_ytdl, tmp_root, fake_aligner, fake_whisper):
    response = client.post(
        "/youtube/extract",
        json={"videoId": "dQw4w9WgXcQ", "separate": False, "lyricsCandidates": CANDIDATES, "lyricsPrompt": "Artista - Título"},
    )
    assert response.status_code == 200
    lyrics = response.json()["lyrics"]
    assert lyrics["source"] == "ytmusic" and lyrics["wer"] == 0
    assert [c["source"] for c in lyrics["candidates"]] == ["lrclib", "ytmusic"]
    assert [(l["text"], l["startMs"]) for l in lyrics["lines"]] == [("Olá mundo", 300), ("Tudo bem", 1500)]
    assert [l.text for l in fake_aligner[0]] == ["Olá mundo", "Tudo bem"]
    assert len(response.json()["alignment"]["lines"]) == 2
    assert fake_whisper["prompts"] == ["Artista - Título"]
    # A transcrição vai junto, palavra a palavra, para a API guardar como evidência (sdd-012).
    assert response.json()["transcript"] == [
        {"text": "olá", "startMs": 300, "endMs": 500, "probability": 0.9},
        {"text": "mundo", "startMs": 600, "endMs": 800, "probability": 0.9},
        {"text": "tudo", "startMs": 1500, "endMs": 1700, "probability": 0.9},
        {"text": "bem", "startMs": 1800, "endMs": 2000, "probability": 0.9},
    ]
    assert list(tmp_root.rglob("*")) == []


def test_youtube_extract_sem_candidatas_usa_a_transcricao(client, fake_ytdl, tmp_root, fake_aligner, fake_whisper):
    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "separate": False, "lyricsCandidates": []})
    assert response.status_code == 200
    lyrics = response.json()["lyrics"]
    assert lyrics["source"] == "whisper" and lyrics["wer"] is None and lyrics["candidates"] == []
    assert [l["text"] for l in lyrics["lines"]] == ["olá mundo", "tudo bem"]


def test_whisper_que_falha_nao_derruba_a_extracao(client, fake_ytdl, tmp_root, fake_aligner, fake_whisper):
    fake_whisper["error"] = RuntimeError("sem memória")
    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "separate": False, "lyricsCandidates": CANDIDATES})
    assert response.status_code == 200
    lyrics = response.json()["lyrics"]
    assert lyrics["source"] == "lrclib" and lyrics["wer"] is None
    assert response.json()["transcript"] == []


def test_com_lyrics_conhecida_nao_ha_transcricao(client, fake_ytdl, tmp_root, fake_aligner, fake_whisper):
    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "separate": False, "lyrics": LYRICS})
    assert response.status_code == 200
    assert response.json()["transcript"] is None
    assert fake_whisper["prompts"] == []


def test_extract_multipart_com_candidatas(client, tmp_path, tmp_root, fake_aligner, fake_whisper):
    path = write_wav(tmp_path / "a.wav", sine(440, 3))
    with path.open("rb") as f:
        response = client.post(
            "/extract",
            files={"file": (path.name, f, "application/octet-stream")},
            data={"separate": "false", "lyricsCandidates": json.dumps(CANDIDATES)},
        )
    assert response.status_code == 200
    assert response.json()["lyrics"]["source"] == "ytmusic"
    assert_tmp_clean(tmp_root)


def test_lyrics_e_candidatas_juntos_400(client, fake_ytdl, fake_aligner, fake_whisper):
    response = client.post(
        "/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "lyrics": LYRICS, "lyricsCandidates": CANDIDATES}
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_lyrics"
    assert fake_ytdl.calls == []


@pytest.mark.parametrize("bad", [[{"source": "genius", "lines": []}], [{"source": "lrclib"}], "texto"])
def test_candidatas_malformadas_400(client, fake_ytdl, fake_aligner, fake_whisper, bad):
    response = client.post("/youtube/extract", json={"videoId": "dQw4w9WgXcQ", "lyricsCandidates": bad})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_lyrics"


def test_extract_multipart_candidatas_malformadas_400(client, tmp_path, tmp_root, fake_aligner, fake_whisper):
    path = write_wav(tmp_path / "a.wav", sine(440, 3))
    with path.open("rb") as f:
        response = client.post(
            "/extract",
            files={"file": (path.name, f, "application/octet-stream")},
            data={"lyricsCandidates": "não é json"},
        )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_lyrics"
    assert_tmp_clean(tmp_root)
