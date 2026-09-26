"""Escolha da letra (sdd-011): funções puras, com transcrições sintéticas (sem modelo)."""

import pytest

from app import lyrics_selection as sel
from app.schemas import LyricsCandidate, LyricsLine
from app.transcription import Transcript, Word


def transcript(text: str, start_ms: int = 0, step_ms: int = 300, pause_every: int | None = None, pause_ms: int = 1_000) -> Transcript:
    """Uma palavra a cada `step_ms`; com `pause_every`, uma pausa de `pause_ms` a cada tantas palavras."""
    words = []
    t = start_ms
    for index, raw in enumerate(text.split()):
        if pause_every and index and index % pause_every == 0:
            t += pause_ms
        words.append(Word(text=raw, startMs=t, endMs=t + 200, probability=0.9))
        t += step_ms
    return Transcript(words=words, language="pt")


def candidate(source: str, *texts: str, starts: list[int | None] | None = None) -> LyricsCandidate:
    starts = starts or [None] * len(texts)
    return LyricsCandidate(source=source, lines=[LyricsLine(text=t, startMs=s) for t, s in zip(texts, starts)])


# ── words / wer ───────────────────────────────────────────────────────


def test_words_tira_acento_pontuacao_e_marcacao():
    assert sel.words("Não, é  você! [Refrão] It's (2x) x3") == ["nao", "e", "voce", "its", "x3"]
    assert sel.words("[Verse 2: Fulano]") == []


@pytest.mark.parametrize(
    ("ref", "hyp", "expected"),
    [
        ("a b c", "a b c", 0.0),
        ("a b c d", "a x c d", 0.25),      # substituição
        ("a b c d", "a c d", 0.25),        # remoção
        ("a b", "a b c d", 1.0),           # inserções
        ("", "", 0.0),
        ("", "a", 1.0),
    ],
)
def test_wer(ref, hyp, expected):
    assert sel.wer(ref.split(), hyp.split()) == pytest.approx(expected)


# ── choose ────────────────────────────────────────────────────────────

LETRA = ("Todos os dias quando acordo", "Não tenho mais o tempo que passou", "Mas tenho muito tempo")
CANTADO = "todos os dias quando acordo não tenho mais o tempo que passou mas tenho muito tempo"


def test_candidata_certa_ganha_da_letra_de_outra_musica():
    chosen = sel.choose(
        [candidate("lrclib", "Load up on guns bring your friends", "It's fun to lose and to pretend"), candidate("lrclib", *LETRA)],
        transcript(CANTADO),
        60_000,
    )
    assert chosen.source == "lrclib" and chosen.wer == 0
    assert [l.text for l in chosen.lines] == list(LETRA)
    assert [c.wer for c in chosen.candidates][0] > sel.MAX_WER


def test_letra_de_outra_versao_com_o_mesmo_texto_ganha_e_fica_com_o_tempo_dela():
    """Tempo Perdido: o LRC é de outra gravação (47 s), a voz começa em 0 s. O texto combina."""
    chosen = sel.choose([candidate("lrclib", *LETRA, starts=[47_000, 54_000, 59_000])], transcript(CANTADO), 60_000)
    assert chosen.source == "lrclib"
    assert [l.startMs for l in chosen.lines] == [47_000, 54_000, 59_000]


def test_empate_prefere_youtube_music():
    chosen = sel.choose([candidate("lrclib", *LETRA), candidate("ytmusic", *LETRA)], transcript(CANTADO), 60_000)
    assert chosen.source == "ytmusic"


def test_empate_nao_troca_a_melhor_por_uma_acima_do_limite(monkeypatch):
    """LRCLIB dentro do limite e YouTube Music empatado, mas acima dele: fica o LRCLIB."""
    wers = {"lrclib": sel.MAX_WER - 0.01, "ytmusic": sel.MAX_WER + 0.005}
    monkeypatch.setattr(sel, "wer", lambda ref, hyp: wers[ref[0]])
    chosen = sel.choose([candidate("ytmusic", "ytmusic"), candidate("lrclib", "lrclib")], transcript(CANTADO), 60_000)
    assert chosen.source == "lrclib"
    assert chosen.wer == round(wers["lrclib"], 4)


def test_menor_wer_ganha_fora_do_empate():
    errada = ("Todos os dias quando acordo", "Não tenho mais o tempo que ficou", "Mas tenho pouco tempo pra você")
    chosen = sel.choose([candidate("ytmusic", *errada), candidate("lrclib", *LETRA)], transcript(CANTADO), 60_000)
    assert chosen.source == "lrclib"


def test_nenhuma_combina_usa_a_transcricao_em_versos():
    chosen = sel.choose(
        [candidate("ytmusic", "Load up on guns bring your friends")],
        transcript(CANTADO, pause_every=5),
        60_000,
    )
    assert chosen.source == "whisper" and chosen.wer is None
    assert [c.source for c in chosen.candidates] == ["ytmusic"]
    assert chosen.lines[0].text == "todos os dias quando acordo"
    assert chosen.lines[0].startMs == 0


def test_sem_candidatas_usa_a_transcricao():
    chosen = sel.choose([], transcript("olá mundo"), 60_000)
    assert chosen.source == "whisper" and chosen.candidates == []
    assert [l.text for l in chosen.lines] == ["olá mundo"]


def test_transcricao_vazia_fica_com_a_primeira_candidata_com_palavras_sem_wer():
    chosen = sel.choose([candidate("ytmusic", "[Instrumental]"), candidate("lrclib", *LETRA)], Transcript(words=[], language=None), 30_000)
    assert chosen.source == "lrclib" and chosen.wer is None
    assert [c.wer for c in chosen.candidates] == [None, None]
    # Sem transcrição nem tempo: espalhadas pela música.
    assert [l.startMs for l in chosen.lines] == [0, 10_000, 20_000]


def test_transcricao_vazia_e_sem_candidatas_devolve_letra_vazia():
    chosen = sel.choose([], Transcript(words=[], language=None), 30_000)
    assert chosen.source == "whisper" and chosen.lines == []


def test_linhas_em_branco_de_letra_em_texto_saem_e_as_do_lrc_ficam():
    plain = sel.choose([candidate("lrclib", LETRA[0], "", LETRA[1], LETRA[2])], transcript(CANTADO), 60_000)
    assert [l.text for l in plain.lines] == list(LETRA)
    synced = sel.choose([candidate("lrclib", LETRA[0], "", LETRA[1], LETRA[2], starts=[0, 1_000, 2_000, 3_000])], transcript(CANTADO), 60_000)
    assert [l.text for l in synced.lines] == [LETRA[0], "", LETRA[1], LETRA[2]]


# ── hint_starts / transcript_lines ────────────────────────────────────


def test_dica_vem_da_primeira_palavra_casada_de_cada_linha():
    lines = [LyricsLine(text=t) for t in LETRA]
    # 5 palavras a 300 ms; a 2ª linha começa na palavra 5 (1 500 ms), a 3ª na 12 (3 600 ms).
    assert sel.hint_starts(lines, transcript(CANTADO), 60_000) == [0, 1_500, 3_600]


def test_linha_sem_casamento_herda_a_vizinha():
    lines = [LyricsLine(text="la la la"), LyricsLine(text=LETRA[0]), LyricsLine(text="uô uô"), LyricsLine(text=LETRA[2])]
    hints = sel.hint_starts(lines, transcript(f"{LETRA[0]} {LETRA[2]}", start_ms=5_000), 60_000)
    assert hints == [4_000, 5_000, 6_000, 6_500]


def test_dica_nunca_negativa():
    lines = [LyricsLine(text="la la la"), LyricsLine(text=LETRA[0])]
    assert sel.hint_starts(lines, transcript(LETRA[0], start_ms=300), 60_000) == [0, 300]


def test_versos_da_transcricao_quebram_na_pausa_e_no_limite_de_palavras():
    lines = sel.transcript_lines(transcript("um dois três quatro cinco seis", pause_every=3))
    assert [l.text for l in lines] == ["um dois três", "quatro cinco seis"]
    assert lines[1].startMs == 3 * 300 + 1_000

    long_line = sel.transcript_lines(transcript(" ".join(["la"] * 25)))
    assert [len(l.text.split()) for l in long_line] == [sel.LINE_MAX_WORDS, sel.LINE_MAX_WORDS, 5]


# ── guess_language (a língua vai ao Whisper) ──────────────────────────

PT = ("Eu não sei mais o que fazer com você", "Meu coração já tá cansado de tudo", "Isso é tudo que eu vou dizer pra ela")
EN = ("I don't know what to do with you", "My heart is tired of it all", "That is all I'm gonna say to you")
ES = ("Yo no sé qué hacer contigo", "Mi corazón está cansado de todo", "Eres todo lo que quiero y soy tuyo", "Cuando estoy con los amigos")


@pytest.mark.parametrize("lines, expected", [(PT, "pt"), (EN, "en"), (ES, "es")])
def test_guess_language_pela_letra(lines, expected):
    assert sel.guess_language([candidate("ytmusic", *lines)]) == expected


def test_guess_language_soma_as_candidatas():
    assert sel.guess_language([candidate("ytmusic", PT[0]), candidate("lrclib", PT[1], PT[2])]) == "pt"


def test_guess_language_sem_candidata_ou_letra_curta_deixa_o_whisper_adivinhar():
    assert sel.guess_language([]) is None
    assert sel.guess_language([candidate("ytmusic", "Eu e você")]) is None


def test_guess_language_bilingue_sem_vantagem_clara_deixa_o_whisper_adivinhar():
    assert sel.guess_language([candidate("ytmusic", *PT, *EN)]) is None


def test_guess_language_ignora_marcacao():
    assert sel.guess_language([candidate("ytmusic", "[Chorus: the and you i to my me it is]", *PT)]) == "pt"
