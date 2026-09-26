"""`POST /youtube/align` (sdd-012): a letra atual e a proposta alinhadas sobre a mesma voz,
com uma única passada do wav2vec2. Sem modelo: `emissions` e `align_lines` são falsos."""

import pytest
import torch

from app import alignment
from app.schemas import LineAlignment, LyricsLine

VALID_ID = "dQw4w9WgXcQ"
CURRENT = [{"text": "Olá mundo", "startMs": 500}, {"text": "", "startMs": 1_500}, {"text": "Tudo bem", "startMs": 2_000}]
PROPOSED = [{"text": "Olá, mundo!", "startMs": 500}, {"text": "", "startMs": 1_500}, {"text": "Tudo bem?", "startMs": 2_000}, {"text": "Verso novo", "startMs": 3_000}]


@pytest.fixture
def fake_emissions(monkeypatch):
    """Conta as passadas do wav2vec2 e devolve, por letra, um alinhamento fabricado."""
    state = {"emissions": 0, "aligned": []}

    def emissions(mono):
        state["emissions"] += 1
        return torch.zeros((10, 3))

    def align_lines(log_probs, lines: list[LyricsLine]):
        state["aligned"].append([line.text for line in lines])
        return [
            LineAlignment(index=i, startMs=None if not line.text else 100 * i, endMs=None if not line.text else 100 * i + 50, score=None if not line.text else 0.8)
            for i, line in enumerate(lines)
        ]

    monkeypatch.setattr(alignment, "emissions", emissions)
    monkeypatch.setattr(alignment, "align_lines", align_lines)
    return state


def test_alinha_as_duas_letras_com_uma_passada_do_modelo(client, fake_ytdl, tmp_root, fake_emissions):
    response = client.post("/youtube/align", json={"videoId": VALID_ID, "separate": False, "current": CURRENT, "proposed": PROPOSED})

    assert response.status_code == 200
    body = response.json()
    assert body["durationMs"] > 2_900
    assert [l["index"] for l in body["current"]["lines"]] == [0, 1, 2]
    assert [l["index"] for l in body["proposed"]["lines"]] == [0, 1, 2, 3]
    assert body["current"]["lines"][1] == {"index": 1, "startMs": None, "endMs": None, "score": None}
    assert body["proposed"]["lines"][3] == {"index": 3, "startMs": 300, "endMs": 350, "score": 0.8}
    assert fake_emissions["emissions"] == 1
    assert fake_emissions["aligned"] == [[l["text"] for l in CURRENT], [l["text"] for l in PROPOSED]]
    assert list(tmp_root.rglob("*")) == []


def test_letra_sem_texto_alinhavel_devolve_null_sem_rodar_o_modelo(client, fake_ytdl, fake_emissions):
    response = client.post("/youtube/align", json={"videoId": VALID_ID, "separate": False, "current": [{"text": ""}], "proposed": [{"text": "..."}]})

    assert response.status_code == 200
    assert response.json()["current"] is None and response.json()["proposed"] is None
    assert fake_emissions["emissions"] == 0


def test_so_uma_das_letras_alinhavel(client, fake_ytdl, fake_emissions):
    response = client.post("/youtube/align", json={"videoId": VALID_ID, "separate": False, "current": [], "proposed": PROPOSED})

    assert response.status_code == 200
    assert response.json()["current"] is None
    assert len(response.json()["proposed"]["lines"]) == 4
    assert fake_emissions["emissions"] == 1


def test_modelo_que_falha_devolve_null_nas_duas(client, fake_ytdl, monkeypatch):
    def boom(mono):
        raise RuntimeError("sem memória")

    monkeypatch.setattr(alignment, "emissions", boom)
    response = client.post("/youtube/align", json={"videoId": VALID_ID, "separate": False, "current": CURRENT, "proposed": PROPOSED})

    assert response.status_code == 200
    assert response.json() == {"durationMs": response.json()["durationMs"], "current": None, "proposed": None}


@pytest.mark.parametrize(
    "body",
    [
        {"videoId": VALID_ID, "current": CURRENT},                              # sem proposed
        {"videoId": VALID_ID, "current": "texto", "proposed": PROPOSED},        # current não é lista
        {"videoId": VALID_ID, "current": CURRENT, "proposed": [{"startMs": 1}]},  # linha sem text
    ],
)
def test_letras_malformadas_400_invalid_lyrics(client, fake_ytdl, fake_emissions, body):
    response = client.post("/youtube/align", json=body)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_lyrics"
    assert fake_ytdl.calls == []


@pytest.mark.parametrize("bad", ["abc", "https://youtu.be/dQw4w9WgXcQ", ""])
def test_video_id_invalido_400(client, fake_ytdl, fake_emissions, bad):
    response = client.post("/youtube/align", json={"videoId": bad, "current": CURRENT, "proposed": PROPOSED})

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_video_id"
    assert fake_ytdl.calls == []


def test_align_many_reaproveita_as_emissoes(monkeypatch):
    calls = {"emissions": 0}

    def emissions(mono):
        calls["emissions"] += 1
        return torch.zeros((10, 3))

    monkeypatch.setattr(alignment, "emissions", emissions)
    monkeypatch.setattr(alignment, "align_lines", lambda log_probs, lines: [LineAlignment(index=i, startMs=0, endMs=20, score=0.5) for i in range(len(lines))])

    results = alignment.align_many(None, [[LyricsLine(text="Olá mundo")], [], [LyricsLine(text="Tudo bem"), LyricsLine(text="")]])

    assert calls["emissions"] == 1
    assert results[1] is None
    assert [len(r.lines) for r in (results[0], results[2])] == [1, 2]
