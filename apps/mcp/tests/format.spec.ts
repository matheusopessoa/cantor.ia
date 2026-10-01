import { describe, expect, it } from "vitest";
import { ReviewApiError, type ReviewCheck, type ReviewSongDetail } from "../src/api-client.js";
import { formatApplied, formatCheck, formatError, formatMs, formatScore, formatSongDetail, formatSongList } from "../src/format.js";

const SONG_ID = "019a0000-0000-7000-8000-000000000000";

describe("formatMs / formatScore", () => {
  it("tempo em m:ss.d e score com 2 casas ou travessão", () => {
    expect(formatMs(0)).toBe("0:00.0");
    expect(formatMs(75_250)).toBe("1:15.3");
    expect(formatScore(0.8765)).toBe("0.88");
    expect(formatScore(null)).toBe("—");
  });
});

describe("formatSongList", () => {
  it("lista vazia avisa", () => {
    expect(formatSongList([])).toMatch(/Nenhuma música/);
  });

  it("uma linha por música com origem, versos, encaixe e revisão", () => {
    const text = formatSongList([
      { id: SONG_ID, artist: "Christina Perri", title: "A Thousand Years", lyricsSource: "whisper", matchedRatio: 0.6, lines: 25, reviewedAt: null },
      { id: "b", artist: "Pitty", title: "Na Sua Estante", lyricsSource: null, matchedRatio: null, lines: 40, reviewedAt: "2026-09-26T10:00:00.000Z" },
    ]);

    expect(text).toContain("2 música(s) para revisar");
    expect(text).toContain(`- Christina Perri — A Thousand Years · id: ${SONG_ID} · letra: transcrição automática (whisper) — prioridade de revisão · 25 versos · encaixe no áudio: 60 % · ainda não revisada`);
    expect(text).toContain("- Pitty — Na Sua Estante · id: b · letra: LRCLIB (música antiga) · 40 versos · encaixe no áudio: — · revisada em 2026-09-26 10:00 UTC");
    expect(text).toContain("get_song_lyrics");
  });
});

const DETAIL: ReviewSongDetail = {
  id: SONG_ID,
  artist: "Christina Perri",
  title: "A Thousand Years",
  youtubeVideoId: "dQw4w9WgXcQ",
  lyricsRevision: 1,
  selection: { source: "whisper", wer: null, candidates: [] },
  lines: [
    { index: 0, text: "Heart beats fast", startMs: 12_300 },
    { index: 1, text: "", startMs: 15_000 },
    { index: 2, text: "Colors and promisses", startMs: 16_100 },
  ],
  transcriptLines: [
    { text: "heart beats fast", startMs: 12_250 },
    { text: "colors and promises", startMs: 16_050 },
  ],
  candidates: [{ source: "lrclib", lines: ["Some other song", "entirely"] }],
};

describe("formatSongDetail", () => {
  it("mostra a letra numerada com tempo, a transcrição e as candidatas, mais o limite de memória", () => {
    const text = formatSongDetail(DETAIL);

    expect(text).toContain("Christina Perri — A Thousand Years");
    expect(text).toContain("vídeo: dQw4w9WgXcQ · versão da letra: 1");
    expect(text).toContain("origem da letra: transcrição automática (whisper)");
    expect(text).toContain("    0  [0:12.3]  Heart beats fast");
    expect(text).toContain("    1  [0:15.0]  (instrumental)");
    expect(text).toContain("O que o Whisper ouviu na gravação (2 trechos");
    expect(text).toContain("  [0:12.3]  heart beats fast");
    expect(text).toContain("Letra do site LRCLIB (2 versos");
    expect(text).toContain("  Some other song");
    expect(text).toContain("check_lyrics_fix");
    expect(text).toContain("não escreva a letra de memória");
  });

  it("sem evidência (música antiga) explica; sem vídeo avisa que não dá para conferir", () => {
    const text = formatSongDetail({ ...DETAIL, youtubeVideoId: null, selection: null, transcriptLines: null, candidates: null });

    expect(text).toContain("vídeo: nenhum (referência por arquivo");
    expect(text).toContain("origem da letra: LRCLIB (música antiga)");
    expect(text).toContain("Sem transcrição da voz guardada");
    expect(text).not.toContain("Letra do site");
  });

  it("transcrição vazia e nenhuma candidata", () => {
    const text = formatSongDetail({ ...DETAIL, transcriptLines: [], candidates: [] });

    expect(text).toContain("Transcrição da voz: vazia");
    expect(text).toContain("Letras dos sites: nenhuma foi encontrada");
  });

  it("origem de site mostra o WER e a revisão", () => {
    const text = formatSongDetail({ ...DETAIL, selection: { source: "ytmusic", wer: 0.07, candidates: [], reviewedAt: "2026-09-26T10:00:00.000Z" } });

    expect(text).toContain("origem da letra: YouTube Music (WER 7 % contra a voz) · revisada em 2026-09-26 10:00 UTC");
  });
});

const CHECK: ReviewCheck = {
  checkId: "0f1e2d3c-0000-4000-8000-000000000000",
  expiresAt: "2026-09-26T10:30:00.000Z",
  lines: [
    { index: 0, text: "Heart beats fast", startMs: 12_300, score: 0.9, change: "same", before: { text: "Heart beats fast", score: 0.9 } },
    { index: 1, text: "Colors and promises", startMs: 16_100, score: 0.85, change: "edited", before: { text: "Colors and promisses", score: 0.5 } },
    { index: 2, text: "How to be brave", startMs: 17_100, score: 0.7, change: "added" },
    { index: 3, text: "", startMs: 18_100, score: null, change: "added" },
  ],
  removed: [{ text: "la la la", score: 0.2 }],
  summary: { edited: 1, added: 2, removed: 1, meanScoreBefore: 0.53, meanScoreAfter: 0.817 },
};

describe("formatCheck", () => {
  it("resumo, versos com marca e antes/depois, removidos, checkId e o aviso de aprovação", () => {
    const text = formatCheck(CHECK);

    expect(text).toContain("1 editado(s), 2 novo(s), 1 removido(s) · score médio 0.53 → 0.82");
    expect(text).toContain("      0  [0:12.3]  0.90  Heart beats fast");
    expect(text).toContain("  ~   1  [0:16.1]  0.85  Colors and promises");
    expect(text).toContain("        antes: 0.50  Colors and promisses");
    expect(text).toContain("  +   2  [0:17.1]  0.70  How to be brave");
    expect(text).toContain("  +   3  [0:18.1]  —  (instrumental)");
    expect(text).toContain("  - 0.20  la la la");
    expect(text).toContain("checkId: 0f1e2d3c-0000-4000-8000-000000000000 (vale até 2026-09-26 10:30 UTC)");
    expect(text).toContain("só chame apply_lyrics_fix depois que ele aprovar");
  });

  it("sem removidos não mostra a seção", () => {
    expect(formatCheck({ ...CHECK, removed: [] })).not.toContain("Versos removidos");
  });
});

describe("formatApplied", () => {
  const applied = {
    id: SONG_ID,
    artist: "Christina Perri",
    title: "A Thousand Years",
    lyrics: [{ startMs: 0, text: "a" }, { startMs: 1, text: "b" }],
    alignedLyrics: null,
    lyricsAlignment: { aligned: true, shiftMs: 0, matchedRatio: 0.92, method: "forced" as const },
    lyricsSelection: { source: "whisper" as const, wer: null, candidates: [], reviewedAt: "2026-09-26T10:05:00.000Z" },
  };

  it("confirma o que foi gravado", () => {
    const text = formatApplied(applied);

    expect(text).toContain("Letra gravada: Christina Perri — A Thousand Years (2 versos, alinhada ao áudio (92 % dos versos encaixados))");
    expect(text).toContain("Marcada como revisada em 2026-09-26 10:05 UTC; a origem continua transcrição automática (whisper)");
    expect(text).toContain("notas e ranking já gravados não mudam");
  });

  it("alinhamento recusado avisa", () => {
    const text = formatApplied({ ...applied, lyricsAlignment: { aligned: false, shiftMs: 0, matchedRatio: 0.3 } });

    expect(text).toContain("alinhamento recusado (30 % encaixados)");
  });
});

describe("formatError", () => {
  it("status + código + mensagem, com a dica do código", () => {
    const text = formatError(new ReviewApiError(409, "LYRICS_CHANGED", "Lyrics changed since the check"));

    expect(text).toBe("A API respondeu 409 LYRICS_CHANGED: Lyrics changed since the check\nA letra mudou desde a conferência (refazer ou outra revisão): leia de novo com get_song_lyrics e confira de novo.");
  });

  it("falha de rede e código desconhecido", () => {
    expect(formatError(new ReviewApiError(0, "UNREACHABLE", "fora"))).toMatch(/^Falha de rede UNREACHABLE: fora\nA API não está de pé/);
    expect(formatError(new ReviewApiError(500, null, "Internal server error"))).toBe("A API respondeu 500: Internal server error");
  });
});
