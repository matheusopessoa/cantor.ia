"""Alinhamento forçado (sdd-010) sem modelo real: log-probs fabricados com picos dos tokens em
frames conhecidos. Sinal sintético não serve para um CTC de fala, então o que se testa aqui é
a montagem dos alvos (`*`, linhas sem texto), a leitura do caminho e as bordas."""

import math

import numpy as np
import pytest
import torch

from app import alignment
from app.alignment import FRAME_MS, MIN_TOKENS, STAR_GAP_MS, align_lines, emissions, normalize_line
from app.schemas import LyricsLine

DICT = alignment._DICTIONARY
STAR = DICT["*"]
C = len(DICT)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Não, 'tava ali!", "naotavaali"),
        ("Coração", "coracao"),
        ("ÀÉÎÕÜ ç Ñ", "aeioucn"),
        ("1, 2, 3 vamos", "vamos"),
        ("", ""),
        ("   ...  ", ""),
        ("Já é 23h59?!", "jaeh"),
    ],
)
def test_normalize_line(text, expected):
    assert "".join(normalize_line(text)) == expected


def fabricate(events: list[tuple[int, int]], frames: int) -> torch.Tensor:
    """Log-probs `(frames, C)`: blank quase certo em todo frame, exceto nos `(frame, token)`
    dados, em que o token domina. Quem chamar garante a ordem dos eventos."""
    probs = torch.full((frames, C), 1e-6)
    probs[:, 0] = 1.0
    for frame, token in events:
        probs[frame, 0] = 1e-6
        probs[frame, token] = 1.0
    return torch.log(probs / probs.sum(dim=1, keepdim=True))


def events_for(lines: list[LyricsLine], starts_frame: list[int | None], spacing: int = 2) -> list[tuple[int, int]]:
    """Um evento por caractere de cada linha, `spacing` frames entre caracteres, começando no
    frame dado (linhas com `None` são puladas)."""
    events = []
    for line, start in zip(lines, starts_frame):
        if start is None:
            continue
        for k, char in enumerate(normalize_line(line.text)):
            events.append((start + k * spacing, DICT[char]))
    return events


def test_align_lines_devolve_os_instantes_fabricados():
    lines = [LyricsLine(text="Olá mundo", startMs=1_000), LyricsLine(text="Tudo bem", startMs=3_000)]
    starts = [50, 150]                       # frames → 1000 ms e 3000 ms
    log_probs = fabricate(events_for(lines, starts), frames=300)

    result = align_lines(log_probs, lines)

    assert [r.index for r in result] == [0, 1]
    assert result[0].startMs == 50 * FRAME_MS
    assert result[0].endMs == (50 + 2 * (len("olamundo") - 1) + 1) * FRAME_MS
    assert result[1].startMs == 150 * FRAME_MS
    assert result[1].endMs == (150 + 2 * (len("tudobem") - 1) + 1) * FRAME_MS
    assert all(r.score is not None and r.score > 0.9 for r in result)


def test_linha_sem_texto_fica_none_e_nao_desloca_as_outras():
    lines = [
        LyricsLine(text="Primeira linha", startMs=1_000),
        LyricsLine(text="", startMs=2_000),
        LyricsLine(text="...", startMs=2_500),
        LyricsLine(text="a", startMs=2_800),          # 1 caractere < MIN_TOKENS
        LyricsLine(text="Última linha", startMs=3_000),
    ]
    starts = [50, None, None, None, 150]
    result = align_lines(fabricate(events_for(lines, starts), frames=300), lines)

    assert [r.index for r in result] == [0, 1, 2, 3, 4]
    for i in (1, 2, 3):
        assert (result[i].startMs, result[i].endMs, result[i].score) == (None, None, None)
    assert result[0].startMs == 1_000
    assert result[4].startMs == 3_000


def test_estrela_so_em_intervalo_longo_do_lrc():
    # 1 s entre as duas primeiras linhas (sem *), 5 s até a terceira (com *), mais a intro
    # de 6 s antes da primeira e a estrela final.
    lines = [
        LyricsLine(text="um dois", startMs=6_000),
        LyricsLine(text="tres quatro", startMs=7_000),
        LyricsLine(text="cinco seis", startMs=7_000 + STAR_GAP_MS + 1_000),
    ]
    tokens, spans = alignment._targets(lines)

    assert tokens[0] == STAR                                  # intro > STAR_GAP_MS
    assert tokens[-1] == STAR                                 # outro
    assert tokens.count(STAR) == 3
    ini, fim = spans[1]
    assert tokens[ini - 1] != STAR                            # 1 s: sem estrela
    ini, fim = spans[2]
    assert tokens[ini - 1] == STAR                            # 5 s: estrela
    assert [tokens[a:b] for a, b in spans] == [[DICT[c] for c in normalize_line(l.text)] for l in lines]


def test_sem_start_ms_nao_ha_estrela_no_meio():
    lines = [LyricsLine(text="um dois"), LyricsLine(text="tres quatro")]
    tokens, _ = alignment._targets(lines)
    assert tokens.count(STAR) == 1 and tokens[-1] == STAR


def test_estrela_absorve_audio_nao_transcrito_sem_puxar_a_linha_seguinte():
    lines = [LyricsLine(text="casa", startMs=1_000), LyricsLine(text="mesa", startMs=1_000 + STAR_GAP_MS + 2_000)]
    # Entre as linhas há "voz" (tokens aleatórios do alfabeto) que não está na letra.
    noise = [(f, DICT["z"]) for f in range(120, 180)]
    events = events_for(lines, [50, 400]) + noise
    result = align_lines(fabricate(events, frames=500), lines)

    assert result[0].startMs == 50 * FRAME_MS
    assert result[1].startMs == 400 * FRAME_MS
    assert result[0].endMs < 120 * FRAME_MS


def test_mais_tokens_que_frames_devolve_none_geral_sem_lancar():
    lines = [LyricsLine(text="uma linha bem comprida cheia de letras", startMs=0)]
    result = align_lines(fabricate([], frames=5), lines)

    assert len(result) == 1
    assert (result[0].startMs, result[0].endMs, result[0].score) == (None, None, None)


def test_letra_sem_nada_alinhavel_devolve_none_geral():
    lines = [LyricsLine(text="", startMs=0), LyricsLine(text="!!!", startMs=1_000)]
    result = align_lines(fabricate([], frames=100), lines)
    assert all(r.startMs is None for r in result)


def test_letras_repetidas_precisam_de_blank_entre_elas():
    # "aa" exige 3 frames (a, blank, a): com 2 frames o alinhador recusa em vez de lançar.
    lines = [LyricsLine(text="aa", startMs=0)]
    assert alignment._frames_needed(alignment._targets(lines)[0]) == 4      # a, blank, a, *
    assert align_lines(fabricate([], frames=3), lines)[0].startMs is None
    ok = align_lines(fabricate([(0, DICT["a"]), (2, DICT["a"])], frames=4), lines)
    assert ok[0].startMs == 0 and ok[0].endMs == 3 * FRAME_MS


def test_ordem_dos_indices_e_o_tamanho_sao_preservados():
    lines = [LyricsLine(text=f"linha {i}", startMs=i * 1_500) for i in range(20)]
    starts = [10 + i * 30 for i in range(20)]
    result = align_lines(fabricate(events_for(lines, starts), frames=700), lines)

    assert [r.index for r in result] == list(range(20))
    assert [r.startMs for r in result] == [s * FRAME_MS for s in starts]
    assert all(a.startMs < b.startMs for a, b in zip(result, result[1:]))


class FakeModel:
    """Substitui o wav2vec2: 1 frame a cada 320 amostras, forma `(1, T, C)`."""

    calls: list[int] = []

    def __call__(self, wav: torch.Tensor):
        FakeModel.calls.append(wav.shape[-1])
        frames = wav.shape[-1] // 320
        return torch.zeros((1, frames, C)), None


def test_emissions_fatia_em_janelas_de_20s_e_concatena(monkeypatch):
    FakeModel.calls = []
    monkeypatch.setattr(alignment, "_model", FakeModel())
    seconds = 47.3
    mono = np.zeros(int(seconds * 44_100), dtype=np.float32)

    log_probs = emissions(mono)

    expected_frames = round(seconds * 1000 / FRAME_MS)
    assert log_probs.shape[1] == C
    assert abs(log_probs.shape[0] - expected_frames) <= math.ceil(seconds / alignment.CHUNK_S)
    assert FakeModel.calls[:-1] == [alignment.CHUNK_S * alignment.MODEL_SAMPLE_RATE] * 2
    assert 0 < FakeModel.calls[-1] < alignment.CHUNK_S * alignment.MODEL_SAMPLE_RATE


def test_align_devolve_none_para_letra_sem_texto_sem_chamar_o_modelo(monkeypatch):
    def boom(_):
        raise AssertionError("não devia rodar o modelo")

    monkeypatch.setattr(alignment, "emissions", boom)
    assert alignment.align(np.zeros(44_100, dtype=np.float32), []) is None
    assert alignment.align(np.zeros(44_100, dtype=np.float32), [LyricsLine(text="", startMs=0)]) is None


def test_align_falha_do_modelo_vira_none(monkeypatch):
    def boom(_):
        raise RuntimeError("sem memória")

    monkeypatch.setattr(alignment, "emissions", boom)
    assert alignment.align(np.zeros(44_100, dtype=np.float32), [LyricsLine(text="olá mundo", startMs=0)]) is None


def test_align_monta_o_alignment_com_uma_entrada_por_linha(monkeypatch):
    lines = [LyricsLine(text="Olá mundo", startMs=1_000), LyricsLine(text="", startMs=2_000), LyricsLine(text="Tudo bem", startMs=3_000)]
    monkeypatch.setattr(alignment, "emissions", lambda _: fabricate(events_for(lines, [50, None, 150]), frames=300))

    result = alignment.align(np.zeros(44_100, dtype=np.float32), lines)

    assert result is not None
    assert (result.version, result.model, result.frameMs) == (1, "mms_fa", 20)
    assert [l.index for l in result.lines] == [0, 1, 2]
    assert [l.startMs for l in result.lines] == [1_000, None, 3_000]


def test_min_tokens_e_dois():
    assert MIN_TOKENS == 2


def test_emissions_fixa_a_log_prob_da_estrela(monkeypatch):
    class StarZeroModel:
        def __call__(self, wav):
            out = torch.full((1, wav.shape[-1] // 320, C), -3.0)
            out[:, :, alignment._STAR_ID] = 0.0   # como o torchaudio devolve
            return out, None

    monkeypatch.setattr(alignment, "_model", StarZeroModel())
    log_probs = emissions(np.zeros(44_100, dtype=np.float32))
    assert torch.all(log_probs[:, alignment._STAR_ID] == alignment.STAR_LOG_PROB)
    assert torch.all(log_probs[:, 1] == -3.0)
