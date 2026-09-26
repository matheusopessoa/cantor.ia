"""Transcrição (sdd-011 e sdd-014): conversão da saída do Whisper local, com um modelo falso, e
do `whisper-1` da OpenAI, com a rede falsa (`httpx.MockTransport`); `-m slow` carrega o modelo
local de verdade e `-m network` chama a OpenAI de verdade."""

import json
import math
import subprocess
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
from pydantic import SecretStr

from app import audio, config, transcription
from app.audio import SAMPLE_RATE


def word(text: str, start: float, probability: float = 0.9):
    return SimpleNamespace(word=text, start=start, end=start + 0.2, probability=probability)


class FakeModel:
    def __init__(self, segments):
        self.segments = segments
        self.calls = []

    def transcribe(self, audio, **options):
        self.calls.append((audio, options))
        return iter(self.segments), SimpleNamespace(language="pt")


@pytest.fixture
def fake_model(monkeypatch):
    def install(segments):
        model = FakeModel(segments)
        monkeypatch.setattr(transcription, "_model", model)
        return model

    return install


def test_converte_palavras_em_ms_e_passa_as_opcoes(fake_model):
    model = fake_model([SimpleNamespace(words=[word(" Olá,", 0.5), word(" mundo", 1.0)])])
    result = transcription.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), "Artista - Título")
    assert result.language == "pt"
    assert [(w.text, w.startMs, w.endMs) for w in result.words] == [("Olá,", 500, 700), ("mundo", 1000, 1200)]
    audio, options = model.calls[0]
    assert len(audio) == 16_000                      # reamostrado de 44,1 kHz para 16 kHz
    assert options["initial_prompt"] == "Artista - Título"
    assert options["word_timestamps"] and options["vad_filter"] and not options["condition_on_previous_text"]
    assert options["language"] is None               # sem língua: o Whisper detecta sozinho


def test_local_recebe_a_lingua(fake_model):
    model = fake_model([SimpleNamespace(words=[word(" Olá", 0.5)])])
    transcription.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language="pt")
    assert model.calls[0][1]["language"] == "pt"


def test_descarta_verso_de_baixa_confianca_e_palavra_vazia(fake_model):
    fake_model(
        [
            SimpleNamespace(words=[word(" inventado", 1.0, 0.1), word(" texto", 1.5, 0.2)]),
            SimpleNamespace(words=[word(" ", 2.0), word(" certo", 2.5)]),
            SimpleNamespace(words=None),
        ]
    )
    result = transcription.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32))
    assert [w.text for w in result.words] == ["certo"]


@pytest.mark.slow
def test_modelo_real_carrega_e_nao_quebra_em_audio_sem_voz():
    transcription.load()
    t = np.arange(2 * SAMPLE_RATE) / SAMPLE_RATE
    result = transcription.transcribe((0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32))
    assert isinstance(result.words, list)


# ── Provedor OpenAI (sdd-014) ─────────────────────────────────────────

FAKE_KEY = "sk-test-not-a-real-key-0123456789"
VOICE = np.zeros(2 * SAMPLE_RATE, dtype=np.float32)


def segment(start, end, avg_logprob=-0.2, no_speech_prob=0.01, compression_ratio=1.3):
    return {"start": start, "end": end, "avg_logprob": avg_logprob, "no_speech_prob": no_speech_prob, "compression_ratio": compression_ratio}


def openai_body(words, segments, language="portuguese"):
    return {"task": "transcribe", "language": language, "duration": 10.0, "text": "…", "words": words, "segments": segments}


GOOD_BODY = openai_body(
    [{"word": "Olá", "start": 0.5, "end": 0.7}, {"word": "mundo", "start": 1.0, "end": 1.2}],
    [segment(0.0, 2.0)],
)


# _from_openai (puro)


def test_from_openai_converte_palavras_em_ms_com_a_probabilidade_do_segmento():
    body = openai_body(
        [
            {"word": " ¿Olá,", "start": 0.5, "end": 0.7},
            {"word": "mundo", "start": 1.0, "end": 1.25},
            {"word": "fora", "start": 9.0, "end": 9.3},        # fora de qualquer segmento
            {"word": "  ", "start": 1.5, "end": 1.6},           # vazia
            {"word": "...", "start": 1.7, "end": 1.8},          # só pontuação
        ],
        [segment(0.0, 2.0, avg_logprob=-0.5)],
    )
    result = transcription._from_openai(body)

    assert result.language == "pt"
    assert [(w.text, w.startMs, w.endMs) for w in result.words] == [("Olá,", 500, 700), ("mundo", 1000, 1250), ("fora", 9000, 9300)]
    assert result.words[0].probability == round(math.exp(-0.5), 4)
    assert result.words[2].probability == 1.0


@pytest.mark.parametrize(("language", "code"), [("portuguese", "pt"), ("English", "en"), ("pt", "pt"), ("klingon", "klingon"), (None, None)])
def test_from_openai_mapeia_o_idioma(language, code):
    body = {**GOOD_BODY, "language": language}
    assert transcription._from_openai(body).language == code


def test_filtro_descarta_segmento_silencioso_e_repetido_e_mantem_o_bom():
    body = openai_body(
        [
            {"word": "fantasma", "start": 0.5, "end": 0.8},   # silencioso: no_speech alto E logprob baixo
            {"word": "certo", "start": 2.5, "end": 2.8},      # bom
            {"word": "refrão", "start": 4.5, "end": 4.8},     # repetido em laço
            {"word": "duvida", "start": 6.5, "end": 6.8},     # só no_speech alto: fica
            {"word": "baixo", "start": 8.5, "end": 8.8},      # só logprob baixo: fica
        ],
        [
            segment(0.0, 2.0, avg_logprob=-1.5, no_speech_prob=0.9),
            segment(2.0, 4.0),
            segment(4.0, 6.0, compression_ratio=3.1),
            segment(6.0, 8.0, avg_logprob=-0.3, no_speech_prob=0.9),
            segment(8.0, 10.0, avg_logprob=-1.4, no_speech_prob=0.1),
        ],
    )
    assert [w.text for w in transcription._from_openai(body).words] == ["certo", "duvida", "baixo"]


@pytest.mark.parametrize(
    "body",
    [
        {"text": "sem palavras"},                                         # sem words/segments
        {"words": [{"word": "a", "start": "x", "end": 1}], "segments": []},  # start não numérico
        {"words": [{"word": "a", "start": 0, "end": 1}], "segments": [{"start": 0, "end": 1}]},  # segmento incompleto
        [],                                                               # não é objeto
    ],
)
def test_from_openai_recusa_formato_inesperado(body):
    with pytest.raises(Exception):
        transcription._from_openai(body)


# transcribe com a chave (HTTP falso)


@pytest.fixture
def openai(monkeypatch, fake_model):
    """Chave falsa, rede falsa e um Whisper local falso para a reserva."""
    monkeypatch.setattr(config, "settings", lambda: config.Settings(OPENAI_API_KEY=SecretStr(FAKE_KEY)))
    monkeypatch.setattr(transcription, "OPENAI_RETRY_DELAY_S", 0)
    local = fake_model([SimpleNamespace(words=[word(" local", 0.3)])])
    state = {"responses": [], "requests": [], "local": local}

    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        response = state["responses"].pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(transcription, "_transport", httpx.MockTransport(handler))
    return state


def test_com_chave_o_provedor_e_openai(openai):
    assert transcription.provider() == "openai"


def test_sem_chave_o_provedor_e_local():
    assert transcription.provider() == "local"


def test_transcribe_manda_a_requisicao_certa_e_nao_usa_o_local(openai, tmp_path):
    openai["responses"] = [httpx.Response(200, json=GOOD_BODY)]

    result = transcription.transcribe(VOICE, "Artista - Título", tmp_path)

    assert [w.text for w in result.words] == ["Olá", "mundo"]
    assert openai["local"].calls == []
    request = openai["requests"][0]
    assert str(request.url) == transcription.OPENAI_URL
    assert request.headers["authorization"] == f"Bearer {FAKE_KEY}"
    content = request.read()
    for field, value in [("model", b"whisper-1"), ("response_format", b"verbose_json"), ("prompt", "Artista - Título".encode())]:
        assert f'name="{field}"\r\n\r\n'.encode() + value in content
    assert content.count(b'name="timestamp_granularities[]"') == 2
    assert b'name="timestamp_granularities[]"\r\n\r\nword' in content
    assert b'name="timestamp_granularities[]"\r\n\r\nsegment' in content
    assert b'filename="voice-transcription.mp3"' in content and b"Content-Type: audio/mpeg" in content
    # O MP3 some do tmp da requisição assim que a resposta chega.
    assert list(tmp_path.iterdir()) == []


def test_sem_prompt_nao_manda_o_campo(openai):
    openai["responses"] = [httpx.Response(200, json=GOOD_BODY)]
    transcription.transcribe(VOICE)
    content = openai["requests"][0].read()
    assert b'name="prompt"' not in content
    assert b'name="language"' not in content


def test_manda_a_lingua_para_a_openai_inclusive_na_nova_tentativa(openai):
    openai["responses"] = [httpx.Response(503), httpx.Response(200, json=GOOD_BODY)]
    transcription.transcribe(VOICE, language="pt")
    for request in openai["requests"]:
        assert b'name="language"\r\n\r\npt' in request.read()


@pytest.mark.parametrize("first", [httpx.Response(503, json={"error": {"type": "server_error"}}), httpx.Response(429), httpx.ConnectTimeout("lento")])
def test_falha_passageira_e_depois_ok_usa_a_segunda(openai, first):
    openai["responses"] = [first, httpx.Response(200, json=GOOD_BODY)]

    result = transcription.transcribe(VOICE, "A - B")

    assert [w.text for w in result.words] == ["Olá", "mundo"]
    assert len(openai["requests"]) == 2
    assert openai["local"].calls == []


def test_5xx_duas_vezes_cai_no_whisper_local(openai, caplog):
    openai["responses"] = [httpx.Response(500), httpx.Response(502)]

    result = transcription.transcribe(VOICE, "A - B")

    assert [w.text for w in result.words] == ["local"]
    assert len(openai["requests"]) == 2
    assert len(openai["local"].calls) == 1
    assert "OpenAI respondeu 502" in caplog.text


def test_401_cai_na_reserva_sem_nova_tentativa_e_sem_vazar_a_chave(openai, caplog):
    openai["responses"] = [httpx.Response(401, json={"error": {"type": "invalid_request_error", "message": f"Incorrect API key provided: {FAKE_KEY}"}})]

    result = transcription.transcribe(VOICE, "A - B")

    assert [w.text for w in result.words] == ["local"]
    assert len(openai["requests"]) == 1
    assert "OpenAI respondeu 401 (invalid_request_error)" in caplog.text
    assert FAKE_KEY not in caplog.text


@pytest.mark.parametrize("response", [httpx.Response(200, json={"text": "sem palavras"}), httpx.Response(200, content=b"<html>")])
def test_resposta_malformada_cai_na_reserva(openai, response):
    openai["responses"] = [response]

    result = transcription.transcribe(VOICE, "A - B")

    assert [w.text for w in result.words] == ["local"]


def test_reserva_carrega_o_whisper_local_sob_demanda(openai, monkeypatch):
    monkeypatch.setattr(transcription, "_model", None)
    loaded = []

    def load():
        loaded.append(True)
        transcription._model = openai["local"]

    monkeypatch.setattr(transcription, "load", load)
    openai["responses"] = [httpx.Response(401)]

    assert not transcription.is_loaded()
    transcription.transcribe(VOICE)
    assert loaded == [True] and transcription.is_loaded()


def test_encode_mp3_grava_mp3_mono_16k(tmp_path):
    t = np.arange(SAMPLE_RATE) / SAMPLE_RATE
    dst = audio.encode_mp3((0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), tmp_path / "v.mp3")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,channels,sample_rate", "-of", "json", str(dst)],
        capture_output=True, text=True, check=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert (stream["codec_name"], stream["channels"], stream["sample_rate"]) == ("mp3", 1, "16000")


@pytest.mark.network
def test_openai_de_verdade_com_voz_sintetica(monkeypatch):
    """Uma chamada real (≈ US$ 0,001). Pulada sem `OPENAI_API_KEY` no ambiente ou no `.env`."""
    real = config.Settings()
    if real.OPENAI_API_KEY is None:
        pytest.skip("sem OPENAI_API_KEY")
    monkeypatch.setattr(config, "settings", lambda: real)
    t = np.arange(3 * SAMPLE_RATE) / SAMPLE_RATE
    body_calls = []
    original = transcription._from_openai
    monkeypatch.setattr(transcription, "_from_openai", lambda body: body_calls.append(body) or original(body))

    result = transcription._openai((0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), "Teste - Voz", None)

    assert isinstance(result.words, list)
    assert "words" in body_calls[0] and "segments" in body_calls[0]
