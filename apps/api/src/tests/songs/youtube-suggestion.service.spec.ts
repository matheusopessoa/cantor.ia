import { describe, expect, it } from "vitest";
import type { WorkerYoutubeCandidate } from "../../clients/worker.client.js";
import { SUGGESTION_CONFIG, buildQuery, normalize, rank } from "../../services/youtube-suggestion.service.js";

const SONG = { artist: "Legião Urbana", title: "Tempo Perdido", album: "Dois", durationMs: 300_000 };

let nextId = 0;

/** Candidato sintético com 11 caracteres de id, duração igual à letra por padrão. */
function candidate(overrides: Partial<WorkerYoutubeCandidate> = {}): WorkerYoutubeCandidate {
  nextId += 1;
  return {
    videoId: String(nextId).padStart(11, "0"),
    title: "Legião Urbana - Tempo Perdido",
    channel: "Canal Qualquer",
    durationS: SONG.durationMs / 1000,
    viewCount: 10_000,
    isLive: false,
    ...overrides,
  };
}

function ids(result: ReturnType<typeof rank>): string[] {
  return result.candidates.map((c) => c.videoId);
}

describe("normalize", () => {
  it("tira acentos, pontuação e caixa, e compacta espaços", () => {
    expect(normalize("  Legião Urbana — Tempo Perdido (Official Audio)! ")).toBe("legiao urbana tempo perdido official audio");
    expect(normalize("AC/DC")).toBe("ac dc");
    expect(normalize("Reação 8D")).toBe("reacao 8d");
  });
});

describe("buildQuery", () => {
  it("junta artista e título com espaços normalizados, mantendo os acentos", () => {
    expect(buildQuery({ artist: "  Legião   Urbana ", title: " Tempo  Perdido " })).toBe("Legião Urbana Tempo Perdido");
  });

  it("remove parênteses, colchetes e feat. (R2)", () => {
    expect(buildQuery({ artist: "Anitta feat. J Balvin", title: "Downtown (Remastered 2019) [Live]" })).toBe("Anitta Downtown");
    expect(buildQuery({ artist: "Artista ft. Outro", title: "Música featuring Alguém" })).toBe("Artista Música");
  });

  it("cai no texto original quando a limpeza deixaria vazio", () => {
    expect(buildQuery({ artist: "(Artista)", title: "[Intro]" })).toBe("(Artista) [Intro]");
  });

  it("corta em 200 caracteres", () => {
    const query = buildQuery({ artist: "a".repeat(150), title: "b".repeat(150) });
    expect(query.length).toBeLessThanOrEqual(SUGGESTION_CONFIG.queryMaxLength);
    expect(query.startsWith("a".repeat(150))).toBe(true);
  });
});

describe("rank — camada 1 (oficial)", () => {
  it("canal '- Topic' com a duração certa vence 'official video' de canal qualquer e upload com 10× mais visualizações", () => {
    const topic = candidate({ channel: "Legião Urbana - Topic", title: "Tempo Perdido", viewCount: 50_000 });
    const official = candidate({ title: "Legião Urbana - Tempo Perdido (Official Video)", viewCount: 100_000 });
    const popular = candidate({ title: "Tempo Perdido", viewCount: 500_000 });

    const result = rank(SONG, [popular, official, topic]);

    expect(ids(result)).toEqual([topic.videoId, official.videoId, popular.videoId]);
    // "- Topic" leva o nome do artista no canal: conta como canal do artista também.
    expect(result.candidates[0]).toMatchObject({ tier: 1, reasons: ["TOPIC_CHANNEL", "ARTIST_CHANNEL", "EXACT_DURATION"] });
    expect(result.candidates[0]!.score).toBe(3 + 2 + 1);
    expect(result.candidates[1]).toMatchObject({ tier: 1, score: 1 + 1 + 1, reasons: ["OFFICIAL", "EXACT_DURATION"] });
    expect(result.candidates[2]).toMatchObject({ tier: 2, score: 1, reasons: ["EXACT_DURATION", "MOST_VIEWED"] });
  });

  it("'official audio' e canal do artista/VEVO pontuam e viram motivos", () => {
    const audio = candidate({ title: "Legião Urbana - Tempo Perdido (Áudio Oficial)", channel: "LegiaoUrbanaVEVO" });
    const lyric = candidate({ title: "Legião Urbana - Tempo Perdido (Lyric Video)", channel: "Legião Urbana" });

    const result = rank(SONG, [lyric, audio]);

    expect(ids(result)).toEqual([audio.videoId, lyric.videoId]);
    expect(result.candidates[0]!.reasons).toEqual(["OFFICIAL_AUDIO", "ARTIST_CHANNEL", "EXACT_DURATION"]);
    expect(result.candidates[0]!.score).toBe(3 + 2 + 1 + 1);
    expect(result.candidates[1]!.reasons).toEqual(["LYRIC_VIDEO", "ARTIST_CHANNEL", "EXACT_DURATION"]);
  });

  it("'ao vivo' com duração igual perde para um áudio comum, mesmo vindo do canal oficial e mais visto", () => {
    const live = candidate({ title: "Legião Urbana - Tempo Perdido (Ao Vivo)", channel: "Legião Urbana - Topic", viewCount: 1_000_000 });
    const plain = candidate({ title: "Legião Urbana - Tempo Perdido", viewCount: 10 });

    const result = rank(SONG, [live, plain]);

    expect(ids(result)).toEqual([plain.videoId, live.videoId]);
    expect(result.candidates[0]).toMatchObject({ tier: 2, score: 2 }); // título certo + duração exata não é marca de oficial
    expect(result.candidates[1]).toMatchObject({ tier: 2, score: 3 + 2 + 1 + 1 - 5 });
  });

  it("palavras 'ruins' no início de palavra: 'Oliver' e 'Alive' não penalizam", () => {
    const oliver = candidate({ title: "Oliver Tree - Tempo Perdido", viewCount: 10 });
    const alive = candidate({ title: "Stayin' Alive - Tempo Perdido", viewCount: 5 });
    const live = candidate({ title: "Tempo Perdido LIVE", viewCount: 1_000_000 });

    expect(ids(rank(SONG, [live, oliver, alive]))).toEqual([oliver.videoId, alive.videoId, live.videoId]);
  });

  it("título da letra '(Ao Vivo)' não penaliza 'ao vivo' nem 'live'", () => {
    const liveSong = { ...SONG, title: "Tempo Perdido (Ao Vivo)", album: "Live in Rio" };
    const live = candidate({ title: "Legião Urbana - Tempo Perdido (Ao Vivo) live", viewCount: 10 });
    const cover = candidate({ title: "Tempo Perdido cover", viewCount: 1_000_000 });

    const result = rank(liveSong, [cover, live]);

    expect(ids(result)).toEqual([live.videoId, cover.videoId]);
    expect(result.candidates[0]!.score).toBeGreaterThan(result.candidates[1]!.score);
  });
});

describe("rank — camada 2 (sem oficial, vence o mais visto)", () => {
  it("o mais visto com a duração certa vence", () => {
    const a = candidate({ title: "Tempo Perdido", viewCount: 1_000 });
    const b = candidate({ title: "Tempo Perdido karaoke", viewCount: 9_000_000 });
    const c = candidate({ title: "Tempo Perdido", viewCount: 200_000 });

    const result = rank(SONG, [a, b, c]);

    expect(ids(result)).toEqual([c.videoId, a.videoId, b.videoId]);
    expect(result.candidates.every((x) => x.tier === 2)).toBe(true);
    expect(result.candidates[0]!.reasons).toContain("MOST_VIEWED");
    expect(result.candidates[1]!.reasons).not.toContain("MOST_VIEWED");
  });

  it("desempate: na mesma ordem de grandeza de visualizações, a duração exata vence", () => {
    const longer = candidate({ title: "Tempo Perdido", durationS: 303, viewCount: 500_000 });
    const exact = candidate({ title: "Tempo Perdido", durationS: 300.5, viewCount: 200_000 });

    expect(ids(rank(SONG, [longer, exact]))).toEqual([exact.videoId, longer.videoId]);
  });

  it("desempate: com uma ordem de grandeza a mais, o mais visto vence mesmo com 3 s a mais", () => {
    const longer = candidate({ title: "Tempo Perdido", durationS: 303, viewCount: 5_000_000 });
    const exact = candidate({ title: "Tempo Perdido", durationS: 300.5, viewCount: 200_000 });

    expect(ids(rank(SONG, [exact, longer]))).toEqual([longer.videoId, exact.videoId]);
  });

  it("viewCount nulo conta como 0 e não ganha MOST_VIEWED", () => {
    const unknown = candidate({ title: "Tempo Perdido", viewCount: null });
    const few = candidate({ title: "Tempo Perdido", viewCount: 1 });

    const result = rank(SONG, [unknown, few]);

    expect(ids(result)).toEqual([few.videoId, unknown.videoId]);
    expect(result.candidates[1]!.viewCount).toBeNull();

    const alone = rank(SONG, [unknown]);
    expect(alone.candidates[0]!.reasons).not.toContain("MOST_VIEWED");
  });

  it("empate total mantém a ordem da busca", () => {
    const first = candidate({ title: "Tempo Perdido", viewCount: 100 });
    const second = candidate({ title: "Tempo Perdido", viewCount: 100 });

    expect(ids(rank(SONG, [first, second]))).toEqual([first.videoId, second.videoId]);
  });
});

describe("rank — filtro, limite e confiança", () => {
  it("descarta candidato 15 s mais longo, ao vivo e sem duração", () => {
    const tooLong = candidate({ durationS: 315 });
    const live = candidate({ isLive: true });
    const noDuration = candidate({ durationS: null });
    const ok = candidate({ durationS: 309 });

    const result = rank(SONG, [tooLong, live, noDuration, ok]);

    expect(ids(result)).toEqual([ok.videoId]);
    expect(result.candidates[0]!.durationMs).toBe(309_000);
    expect(result.candidates[0]!.reasons).not.toContain("EXACT_DURATION");
  });

  it("nunca devolve mais de 5", () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate({ title: "Tempo Perdido", viewCount: i }));

    expect(rank(SONG, many).candidates).toHaveLength(SUGGESTION_CONFIG.maxCandidates);
  });

  it("confiança: none sem candidatos", () => {
    expect(rank(SONG, [])).toEqual({ query: "Legião Urbana Tempo Perdido", confidence: "none", candidates: [] });
  });

  it("confiança: high com um único oficial (a camada 2 não conta)", () => {
    const topic = candidate({ channel: "Legião Urbana - Topic" });
    const plain = candidate({ title: "Tempo Perdido", viewCount: 9_000_000 });

    expect(rank(SONG, [plain, topic]).confidence).toBe("high");
  });

  it("confiança: high com folga de 2 pontos sobre o segundo oficial; senão medium", () => {
    const topic = candidate({ channel: "Legião Urbana - Topic" }); // 3 + 2 + 1 + 1 = 7
    const weak = candidate({ title: "Tempo Perdido (Official)" }); // 1 + 1 = 2, camada 1
    const close = candidate({ title: "Legião Urbana - Tempo Perdido (Official Audio)", channel: "LegiaoUrbanaVEVO" }); // 3 + 2 + 1 + 1 = 7

    expect(rank(SONG, [topic, weak]).candidates.map((c) => c.tier)).toEqual([1, 1]);
    expect(rank(SONG, [topic, weak]).confidence).toBe("high"); // 7 − 2 ≥ 2
    expect(rank(SONG, [topic, close]).confidence).toBe("medium"); // 7 − 7 = 0
  });

  it("título e duração certos sem marca de oficial ficam na camada 2 (mas na frente dos penalizados)", () => {
    const plain = candidate({ viewCount: 1 });
    const cover = candidate({ title: "Legião Urbana - Tempo Perdido (cover)", viewCount: 1_000_000 });

    const result = rank(SONG, [cover, plain]);

    expect(ids(result)).toEqual([plain.videoId, cover.videoId]);
    expect(result.candidates.map((c) => c.tier)).toEqual([2, 2]);
    expect(result.confidence).toBe("low");
  });

  it("confiança: camada 2 muito vista = medium, pouco vista = low", () => {
    expect(rank(SONG, [candidate({ title: "Tempo Perdido", viewCount: 100_000 })]).confidence).toBe("medium");
    expect(rank(SONG, [candidate({ title: "Tempo Perdido", viewCount: 99_999 })]).confidence).toBe("low");
    expect(rank(SONG, [candidate({ title: "Tempo Perdido", viewCount: null })]).confidence).toBe("low");
  });

  it("não muda a lista de entrada", () => {
    const input = [candidate({ viewCount: 1 }), candidate({ viewCount: 2 })];
    const snapshot = structuredClone(input);

    rank(SONG, input);

    expect(input).toEqual(snapshot);
  });
});
