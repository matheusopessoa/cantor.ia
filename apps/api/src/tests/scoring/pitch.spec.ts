import { describe, it, expect } from "vitest";
import { findOnset, fold12, median, voicedSegments } from "../../utils/pitch.js";

describe("fold12", () => {
  it("mantém diferenças pequenas", () => {
    expect(fold12(0)).toBe(0);
    expect(fold12(2.5)).toBe(2.5);
    expect(fold12(-0.5)).toBe(-0.5);
    expect(fold12(5.9)).toBeCloseTo(5.9, 10);
  });

  it("zera oitavas inteiras", () => {
    expect(fold12(12)).toBe(0);
    expect(fold12(-12)).toBe(0);
    expect(fold12(24)).toBe(0);
  });

  it("devolve sempre um valor em [-6, 6)", () => {
    expect(fold12(6)).toBe(-6);
    expect(fold12(-6)).toBe(-6);
    expect(fold12(18)).toBe(-6);
    expect(fold12(13.5)).toBeCloseTo(1.5, 10);
    expect(fold12(-13.5)).toBeCloseTo(-1.5, 10);
    expect(fold12(-7)).toBe(5);
  });
});

describe("median", () => {
  it("quantidade ímpar devolve o valor central", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("quantidade par devolve a média dos dois centrais", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("lista vazia devolve 0", () => {
    expect(median([])).toBe(0);
  });

  it("não altera o array recebido", () => {
    const values = [9, 1, 5];
    median(values);
    expect(values).toEqual([9, 1, 5]);
  });
});

describe("findOnset", () => {
  const silent = new Array<number | null>(100).fill(null);

  function withVoice(from: number, to: number, base: (number | null)[] = silent): (number | null)[] {
    return base.map((value, i) => (i >= from && i < to ? 60 : value));
  }

  it("sem voz devolve null", () => {
    expect(findOnset(silent, 0, 99, 5)).toBeNull();
  });

  it("voz mais curta que minRun não conta", () => {
    expect(findOnset(withVoice(20, 23), 0, 99, 5)).toBeNull();
  });

  it("encontra o frame exato do onset", () => {
    expect(findOnset(withVoice(20, 60), 0, 99, 5)).toBe(20);
  });

  it("aceita onset cujo trecho continua além do fim da janela", () => {
    expect(findOnset(withVoice(48, 60), 0, 50, 5)).toBe(48);
  });

  it("ignora voz que já vinha soando antes da janela", () => {
    expect(findOnset(withVoice(10, 60), 30, 70, 5)).toBeNull();
  });

  it("voz que começa no frame 0 conta como onset", () => {
    expect(findOnset(withVoice(0, 60), 0, 50, 5)).toBe(0);
  });

  it("devolve o primeiro de vários onsets", () => {
    const track = withVoice(70, 90, withVoice(30, 40));
    expect(findOnset(track, 0, 99, 5)).toBe(30);
  });

  it("com nearFrame devolve o onset mais próximo do alvo, não o primeiro", () => {
    const track = withVoice(70, 90, withVoice(30, 40));
    expect(findOnset(track, 0, 99, 5, 65)).toBe(70);
    expect(findOnset(track, 0, 99, 5, 45)).toBe(30);
    expect(findOnset(track, 0, 99, 5, 30)).toBe(30);
  });

  it("com nearFrame, empate fica com o onset anterior", () => {
    const track = withVoice(70, 90, withVoice(30, 40));
    expect(findOnset(track, 0, 99, 5, 50)).toBe(30);
  });

  it("com nearFrame fora da janela ainda escolhe o onset mais próximo dentro dela", () => {
    const track = withVoice(70, 90, withVoice(30, 40));
    expect(findOnset(track, 0, 60, 5, 200)).toBe(30);
    expect(findOnset(track, 60, 99, 5, -10)).toBe(70);
  });

  it("com nearFrame, sem onset na janela devolve null", () => {
    expect(findOnset(silent, 0, 99, 5, 50)).toBeNull();
    expect(findOnset(withVoice(10, 60), 30, 70, 5, 40)).toBeNull();
  });

  it("tolera janela fora dos limites do track", () => {
    expect(findOnset(withVoice(2, 30), -50, 500, 5)).toBe(2);
    expect(findOnset(withVoice(2, 30), 200, 300, 5)).toBeNull();
  });
});

describe("voicedSegments", () => {
  const silent = new Array<number | null>(100).fill(null);

  function withVoice(from: number, to: number, base: (number | null)[] = silent): (number | null)[] {
    return base.map((value, i) => (i >= from && i < to ? 60 : value));
  }

  it("sem voz devolve lista vazia", () => {
    expect(voicedSegments(silent, 10, 250, 80)).toEqual([]);
    expect(voicedSegments([], 10, 250, 80)).toEqual([]);
  });

  it("um trecho contínuo vira um segmento em ms (fim exclusivo)", () => {
    expect(voicedSegments(withVoice(20, 60), 10, 250, 80)).toEqual([{ startMs: 200, endMs: 600 }]);
  });

  it("une trechos separados por buraco de até mergeGapMs", () => {
    const track = withVoice(30, 50, withVoice(0, 10)); // buraco de 20 frames = 200 ms
    expect(voicedSegments(track, 10, 250, 80)).toEqual([{ startMs: 0, endMs: 500 }]);
  });

  it("não une quando o buraco passa de mergeGapMs", () => {
    const track = withVoice(36, 50, withVoice(0, 10)); // buraco de 26 frames = 260 ms
    expect(voicedSegments(track, 10, 250, 80)).toEqual([
      { startMs: 0, endMs: 100 },
      { startMs: 360, endMs: 500 },
    ]);
  });

  it("descarta trechos mais curtos que minSegmentMs, depois de unir", () => {
    expect(voicedSegments(withVoice(10, 17), 10, 250, 80)).toEqual([]); // 70 ms
    expect(voicedSegments(withVoice(10, 18), 10, 250, 80)).toEqual([{ startMs: 100, endMs: 180 }]); // 80 ms
    // Dois ruídos de 50 ms a 100 ms um do outro formam um trecho de 200 ms.
    expect(voicedSegments(withVoice(25, 30, withVoice(10, 15)), 10, 250, 80)).toEqual([{ startMs: 100, endMs: 300 }]);
  });

  it("voz até o último frame fecha no fim do track", () => {
    expect(voicedSegments(withVoice(90, 100), 10, 250, 80)).toEqual([{ startMs: 900, endMs: 1000 }]);
  });

  it("devolve em ordem crescente", () => {
    const track = withVoice(70, 90, withVoice(30, 40));
    expect(voicedSegments(track, 10, 250, 80)).toEqual([
      { startMs: 300, endMs: 400 },
      { startMs: 700, endMs: 900 },
    ]);
  });
});
