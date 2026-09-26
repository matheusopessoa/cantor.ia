"""Escolha da letra (sdd-011): entre as letras dos sites, a que combina com o que é cantado
nesta gravação; sem nenhuma que combine, a própria transcrição da voz vira a letra.

Funções puras (sem modelo): a transcrição chega pronta de `app/transcription.py`. A medida é o
WER por palavra (substituições + remoções + inserções, sobre as palavras da candidata). Letra
de outra versão com o mesmo texto combina (o tempo vem do MMS_FA); letra de outra música não.
"""

import re
import unicodedata

from app.schemas import CandidateScore, LyricsCandidate, LyricsLine, SelectedLyrics
from app.transcription import Transcript, Word

# Candidata com WER acima disto não é a letra desta gravação (calibrado na Etapa 0).
MAX_WER = 0.35
# WERs a até isto um do outro empatam; no empate, a ordem de `SOURCE_PRIORITY` decide.
TIE_WER = 0.02
# YouTube Music primeiro: letra licenciada (LyricFind/Musixmatch), revisada; LRCLIB é comunitário.
SOURCE_PRIORITY = {"ytmusic": 0, "lrclib": 1}
# Versos da transcrição: quebra numa pausa entre palavras a partir disto ou a cada tantas palavras.
LINE_PAUSE_MS = 600
LINE_MAX_WORDS = 10
# Linha sem dica herda a anterior mais isto.
HINT_STEP_MS = 1_000

# "[Refrão]", "[Verse 2: Fulano]": marcação, não é cantado. "(2x)", "x3": repetição anotada.
_ANNOTATION = re.compile(r"\[[^\]]*\]|\(\s*\d+\s*x\s*\)|\(\s*x\s*\d+\s*\)", re.IGNORECASE)


def words(text: str) -> list[str]:
    """Texto → palavras comparáveis: sem marcação, NFKD sem acento, minúsculas, só `[a-z0-9]`.
    O apóstrofo some junto da pontuação (`it's` → `its`), igual nos dois lados."""
    text = _ANNOTATION.sub(" ", text)
    out = []
    for raw in text.split():
        decomposed = unicodedata.normalize("NFKD", raw.lower())
        word = "".join(c for c in decomposed if "a" <= c <= "z" or "0" <= c <= "9")
        if word:
            out.append(word)
    return out


# Palavras frequentes e típicas de cada língua do app, já na forma de `words` (sem acento). Só as
# que não são comuns às outras duas: "que", "a", "o", "de", "como", "nada" ficam de fora.
_LANGUAGE_MARKERS: dict[str, frozenset[str]] = {
    "pt": frozenset(
        "nao voce eu meu minha com uma pra seu sua ele ela nos isso esse essa tambem ja agora "
        "vou vai ta tudo sao ate entao coracao amor".split()
    ),
    "es": frozenset("yo tu mi el los las una con pero muy cuando eres soy estoy quiero hay corazon amor y".split()),
    "en": frozenset("the and you i to my me it is in your of that love dont im on be we all what".split()),
}
# A língua vencedora precisa de tantas palavras típicas e desta vantagem sobre a segunda; senão,
# o Whisper adivinha sozinho (música bilíngue, letra curta).
LANGUAGE_MIN_HITS = 8
LANGUAGE_MIN_RATIO = 2.0


def guess_language(candidates: list[LyricsCandidate]) -> str | None:
    """Língua da música pela letra das candidatas (`pt`, `es` ou `en`), para o Whisper não
    adivinhar pelo começo do áudio (intro instrumental, uma palavra em inglês) e transcrever na
    língua errada. `None` sem candidatas ou sem uma língua clara: aí o Whisper detecta sozinho.
    "amor" e "coracao" contam para pt e es: não desempatam, só somam."""
    counts = {language: 0 for language in _LANGUAGE_MARKERS}
    for candidate in candidates:
        for line in candidate.lines:
            for word in words(line.text):
                for language, markers in _LANGUAGE_MARKERS.items():
                    if word in markers:
                        counts[language] += 1
    ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    (best, hits), (_, second) = ranked[0], ranked[1]
    if hits < LANGUAGE_MIN_HITS or hits < LANGUAGE_MIN_RATIO * second:
        return None
    return best


def _matches(ref: list[str], hyp: list[str]) -> tuple[int, list[tuple[int, int]]]:
    """Distância de edição por palavra e os pares `(i_ref, j_hyp)` iguais no caminho ótimo."""
    n, m = len(ref), len(hyp)
    previous = list(range(m + 1))
    rows = [previous]
    for i in range(1, n + 1):
        current = [i] + [0] * m
        word = ref[i - 1]
        for j in range(1, m + 1):
            current[j] = min(
                previous[j] + 1,                                   # remoção
                current[j - 1] + 1,                                # inserção
                previous[j - 1] + (0 if word == hyp[j - 1] else 1),  # igual/substituição
            )
        rows.append(current)
        previous = current

    pairs: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        same = ref[i - 1] == hyp[j - 1]
        if rows[i][j] == rows[i - 1][j - 1] + (0 if same else 1):
            if same:
                pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif rows[i][j] == rows[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return rows[n][m], pairs


def wer(ref: list[str], hyp: list[str]) -> float:
    """Fração de erros sobre as palavras de `ref`. `ref` vazio: 0 se `hyp` também for, senão 1."""
    if not ref:
        return 0.0 if not hyp else 1.0
    distance, _ = _matches(ref, hyp)
    return distance / len(ref)


def hint_starts(lines: list[LyricsLine], transcript: Transcript, duration_ms: int) -> list[int]:
    """`startMs` de dica por linha (regra 9 da sdd-011): o da própria linha quando a candidata
    tem tempo; senão, o da 1ª palavra da linha casada na transcrição; sem casamento, a anterior
    mais `HINT_STEP_MS` (as do começo, a seguinte menos o passo). Sem transcrição nem tempo,
    as linhas são espalhadas pela música."""
    line_words = [words(line.text) for line in lines]
    ref: list[str] = []
    owner: list[int] = []
    for index, lw in enumerate(line_words):
        ref.extend(lw)
        owner.extend([index] * len(lw))
    hyp: list[str] = []
    hyp_start: list[int] = []
    for word in transcript.words:
        for part in words(word.text):
            hyp.append(part)
            hyp_start.append(word.startMs)
    _, pairs = _matches(ref, hyp) if ref and hyp else (0, [])

    hints: list[int | None] = [line.startMs for line in lines]
    from_transcript: dict[int, int] = {}
    for i_ref, j_hyp in pairs:
        from_transcript.setdefault(owner[i_ref], hyp_start[j_hyp])
    for index, hint in enumerate(hints):
        if hint is None:
            hints[index] = from_transcript.get(index)

    if all(h is None for h in hints):
        step = duration_ms // max(1, len(lines))
        return [index * step for index in range(len(lines))]

    for index in range(1, len(hints)):
        if hints[index] is None and hints[index - 1] is not None:
            hints[index] = hints[index - 1] + HINT_STEP_MS
    for index in range(len(hints) - 2, -1, -1):
        if hints[index] is None and hints[index + 1] is not None:
            hints[index] = max(0, hints[index + 1] - HINT_STEP_MS)
    return [max(0, h) for h in hints]  # type: ignore[arg-type]


def transcript_lines(transcript: Transcript) -> list[LyricsLine]:
    """A transcrição em versos: quebra numa pausa ≥ `LINE_PAUSE_MS` ou a cada `LINE_MAX_WORDS`."""
    lines: list[LyricsLine] = []
    current: list[Word] = []

    def flush() -> None:
        if current:
            lines.append(LyricsLine(text=" ".join(w.text for w in current), startMs=current[0].startMs))
            current.clear()

    for word in transcript.words:
        if current and (word.startMs - current[-1].endMs >= LINE_PAUSE_MS or len(current) >= LINE_MAX_WORDS):
            flush()
        current.append(word)
    flush()
    return lines


def _usable(candidate: LyricsCandidate) -> LyricsCandidate:
    """Tira linhas sem palavras que também não têm tempo (linha em branco de letra em texto)."""
    return candidate.model_copy(update={"lines": [l for l in candidate.lines if words(l.text) or l.startMs is not None]})


def choose(candidates: list[LyricsCandidate], transcript: Transcript, duration_ms: int) -> SelectedLyrics:
    """Regra 6 da sdd-011: menor WER contra a transcrição, aceito até `MAX_WER`; empate prefere
    o YouTube Music. Nenhuma aceita → a transcrição. Transcrição vazia → a primeira candidata
    com palavras, sem WER (não há como comparar)."""
    candidates = [_usable(c) for c in candidates]
    hyp = [w for word in transcript.words for w in words(word.text)]

    scores: list[CandidateScore] = []
    scored: list[tuple[float, int, LyricsCandidate]] = []
    for candidate in candidates:
        ref = [w for line in candidate.lines for w in words(line.text)]
        value = round(wer(ref, hyp), 4) if ref and hyp else None
        scores.append(CandidateScore(source=candidate.source, wer=value))
        if value is not None:
            scored.append((value, SOURCE_PRIORITY[candidate.source], candidate))

    def selected(source: str, value: float | None, lines: list[LyricsLine]) -> SelectedLyrics:
        return SelectedLyrics(source=source, wer=value, candidates=scores, lines=lines)

    def with_hints(candidate: LyricsCandidate) -> list[LyricsLine]:
        hints = hint_starts(candidate.lines, transcript, duration_ms)
        return [LyricsLine(text=line.text, startMs=hint) for line, hint in zip(candidate.lines, hints)]

    if not hyp:
        first = next((c for c in candidates if any(words(l.text) for l in c.lines)), None)
        return selected(first.source, None, with_hints(first)) if first else selected("whisper", None, [])

    if scored:
        # O limite vem antes do empate: uma candidata acima de `MAX_WER` não pode, por
        # prioridade, tirar o lugar da melhor que está dentro dele.
        accepted = [item for item in scored if item[0] <= MAX_WER]
        if accepted:
            best = min(value for value, _, _ in accepted)
            tied = [item for item in accepted if item[0] <= best + TIE_WER]
            value, _, winner = min(tied, key=lambda item: (item[1], item[0]))
            return selected(winner.source, value, with_hints(winner))

    return selected("whisper", None, transcript_lines(transcript))
