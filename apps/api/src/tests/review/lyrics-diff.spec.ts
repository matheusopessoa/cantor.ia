import { describe, expect, it } from "vitest";
import type { ReviewRow } from "../../repositories/song.repository.js";
import {
  diffLines,
  normalizeLine,
  proposedHints,
  REVIEW_CONFIG,
  sortForReview,
  transcriptToLines,
} from "../../services/lyrics-review.service.js";
import type { LyricLine, TranscriptWord } from "../../utils/validators.js";

const CURRENT = ["Olá mundo", "Tudo bem", "", "Até logo"];

function changes(current: string[], proposed: string[]) {
  const diff = diffLines(current, proposed);
  return {
    lines: diff.lines.map((line) => [line.change, line.currentIndex] as const),
    removed: diff.removed.map((line) => line.index),
  };
}

describe("normalizeLine", () => {
  it("tira acento, pontuação e caixa", () => {
    expect(normalizeLine("Não, é  Você!")).toBe("nao e voce");
    expect(normalizeLine("  ...  ")).toBe("");
  });
});

describe("diffLines", () => {
  it("letra igual → tudo same", () => {
    expect(changes(CURRENT, CURRENT)).toEqual({ lines: [["same", 0], ["same", 1], ["same", 2], ["same", 3]], removed: [] });
  });

  it("verso editado no meio mantém as âncoras em volta", () => {
    expect(changes(CURRENT, ["Olá mundo", "Tudo bem?", "", "Até logo"]).lines).toEqual([["same", 0], ["edited", 1], ["same", 2], ["same", 3]]);
    expect(changes(CURRENT, ["Olá mundo", "Nada a ver", "", "Até logo"]).lines).toEqual([["same", 0], ["edited", 1], ["same", 2], ["same", 3]]);
  });

  it("acento ou pontuação corrigidos contam como editado, mas casam pela normalização", () => {
    const diff = diffLines(["coracao partido", "fim"], ["Coração partido", "fim"]);
    expect(diff.lines[0]).toEqual({ index: 0, text: "Coração partido", change: "edited", currentIndex: 0 });
    expect(diff.lines[1]?.change).toBe("same");
  });

  it("verso inserido → added, sem par", () => {
    expect(changes(CURRENT, ["Olá mundo", "Verso novo", "Tudo bem", "", "Até logo"]).lines).toEqual([
      ["same", 0],
      ["added", null],
      ["same", 1],
      ["same", 2],
      ["same", 3],
    ]);
  });

  it("verso removido → removed", () => {
    expect(changes(CURRENT, ["Olá mundo", "", "Até logo"])).toEqual({ lines: [["same", 0], ["same", 2], ["same", 3]], removed: [1] });
  });

  it("verso dividido em dois → o primeiro edita o original, o segundo é novo", () => {
    expect(changes(["Olá mundo tudo bem", "Fim"], ["Olá mundo", "tudo bem", "Fim"]).lines).toEqual([["edited", 0], ["added", null], ["same", 1]]);
  });

  it("dois versos juntados → editado + removido", () => {
    expect(changes(["Olá mundo", "tudo bem", "Fim"], ["Olá mundo tudo bem", "Fim"])).toEqual({
      lines: [["edited", 0], ["same", 2]],
      removed: [1],
    });
  });

  it("letra atual vazia → tudo added; proposta que só remove → tudo removed", () => {
    expect(changes([], ["a", "b"])).toEqual({ lines: [["added", null], ["added", null]], removed: [] });
    expect(changes(["a", "b"], ["c"])).toEqual({ lines: [["edited", 0]], removed: [1] });
  });

  it("preserva o texto proposto como veio (sem normalizar)", () => {
    expect(diffLines(["a"], ["  A!  "]).lines[0]?.text).toBe("  A!  ");
  });
});

describe("proposedHints", () => {
  const current: LyricLine[] = [
    { startMs: 1_000, text: "Olá mundo" },
    { startMs: 5_000, text: "Tudo bem" },
    { startMs: 9_000, text: "Até logo" },
  ];
  const step = REVIEW_CONFIG.lineHintStepMs;

  it("verso mantido ou editado herda o tempo do original", () => {
    const diff = diffLines(current.map((l) => l.text), ["Olá mundo", "Tudo bem?", "Até logo"]);
    expect(proposedHints(current, diff.lines)).toEqual([
      { startMs: 1_000, text: "Olá mundo" },
      { startMs: 5_000, text: "Tudo bem?" },
      { startMs: 9_000, text: "Até logo" },
    ]);
  });

  it("verso novo no meio fica um passo depois da vizinha anterior", () => {
    const diff = diffLines(current.map((l) => l.text), ["Olá mundo", "Verso novo", "Tudo bem", "Até logo"]);
    expect(proposedHints(current, diff.lines).map((l) => l.startMs)).toEqual([1_000, 1_000 + step, 5_000, 9_000]);
  });

  it("verso novo no começo fica um passo antes da seguinte (nunca negativo)", () => {
    const diff = diffLines(current.map((l) => l.text), ["Intro", "Olá mundo", "Tudo bem", "Até logo"]);
    expect(proposedHints(current, diff.lines).map((l) => l.startMs)).toEqual([0, 1_000, 5_000, 9_000]);
    const late = diffLines(["a"], ["x", "y", "a"]);
    expect(proposedHints([{ startMs: 5_000, text: "a" }], late.lines).map((l) => l.startMs)).toEqual([3_000, 4_000, 5_000]);
  });

  it("sem nenhum par, espalha um passo por verso", () => {
    const diff = diffLines([], ["a", "b", "c"]);
    expect(proposedHints([], diff.lines).map((l) => l.startMs)).toEqual([0, step, 2 * step]);
  });
});

describe("transcriptToLines", () => {
  function words(text: string, startMs = 0, stepMs = 300, pauseEvery: number | null = null): TranscriptWord[] {
    let t = startMs;
    return text.split(" ").map((word, index) => {
      if (pauseEvery && index && index % pauseEvery === 0) t += 1_000;
      const item = { text: word, startMs: t, endMs: t + 200, probability: 0.9 };
      t += stepMs;
      return item;
    });
  }

  it("quebra numa pausa longa e a cada 10 palavras, com o tempo da primeira palavra", () => {
    const lines = transcriptToLines(words("um dois três quatro cinco seis", 0, 300, 3));
    expect(lines).toEqual([
      { text: "um dois três", startMs: 0 },
      { text: "quatro cinco seis", startMs: 3 * 300 + 1_000 },
    ]);

    const long = transcriptToLines(words(new Array(25).fill("la").join(" ")));
    expect(long.map((line) => line.text.split(" ").length)).toEqual([10, 10, 5]);
  });

  it("transcrição vazia → nenhum verso", () => {
    expect(transcriptToLines([])).toEqual([]);
  });
});

describe("sortForReview", () => {
  function row(id: string, source: "lrclib" | "ytmusic" | "whisper" | null, matchedRatio: number | null, reviewedAt?: string): ReviewRow {
    return {
      id,
      artist: "A",
      title: id,
      lyrics: [{ startMs: 0, text: "x" }, { startMs: 1, text: "y" }],
      lyricsSelection: source ? { source, wer: null, candidates: [], ...(reviewedAt ? { reviewedAt } : {}) } : null,
      lyricsAlignment: matchedRatio === null ? null : { aligned: true, shiftMs: 0, matchedRatio, method: "forced" },
      createdAt: new Date(),
    };
  }

  it("whisper primeiro, depois menor encaixe, depois a ordem de chegada; sem alinhamento conta como 1", () => {
    const sorted = sortForReview([row("a", null, 0.9), row("b", "whisper", 0.7), row("c", "ytmusic", 0.5), row("d", "whisper", 0.3), row("e", "lrclib", null), row("f", "lrclib", 0.5)]);

    expect(sorted.map((song) => song.id)).toEqual(["d", "b", "c", "f", "a", "e"]);
    expect(sorted[0]).toEqual({ id: "d", artist: "A", title: "d", lyricsSource: "whisper", matchedRatio: 0.3, lines: 2, reviewedAt: null });
    expect(sorted.find((song) => song.id === "e")?.matchedRatio).toBeNull();
  });

  it("mostra quando a letra já foi revisada", () => {
    const [song] = sortForReview([row("a", "whisper", 0.5, "2026-09-26T10:00:00.000Z")]);
    expect(song?.reviewedAt).toBe("2026-09-26T10:00:00.000Z");
  });
});
