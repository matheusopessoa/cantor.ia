import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_THRESHOLDS,
  centsFromReference,
  detectionToMidi,
  foldToReference,
  framesToTrack,
  hitForCents,
  hzToMidi,
  meanCentsError,
  presenceHit,
} from "../lib/pitch";

const HARD = DIFFICULTY_THRESHOLDS.HARD;
const MEDIUM = DIFFICULTY_THRESHOLDS.MEDIUM;

describe("hzToMidi", () => {
  it("A4 (440 Hz) é 69 e A3 (220 Hz) é 57", () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 6);
    expect(hzToMidi(220)).toBeCloseTo(57, 6);
  });

  it("é fracionário entre semitons", () => {
    expect(hzToMidi(466.16)).toBeCloseTo(70, 2);
    expect(hzToMidi(452.9)).toBeCloseTo(69.5, 1);
  });
});

describe("foldToReference", () => {
  it("traz uma oitava abaixo para a referência", () => {
    expect(foldToReference(57, 69)).toBe(69);
  });

  it("traz uma oitava acima para a referência", () => {
    expect(foldToReference(81, 69)).toBe(69);
  });

  it("mantém diferenças de até 6 semitons", () => {
    expect(foldToReference(72, 69)).toBe(72);
    expect(foldToReference(64, 69)).toBe(64);
  });

  it("dobra várias oitavas", () => {
    expect(foldToReference(45.5, 69)).toBeCloseTo(69.5, 6);
  });

  it("sem referência devolve a nota como está", () => {
    expect(foldToReference(57, null)).toBe(57);
  });
});

describe("centsFromReference / hitForCents", () => {
  it("mede o erro em cents já dobrado para a oitava", () => {
    expect(centsFromReference(69.3, 69)).toBeCloseTo(30, 6);
    expect(centsFromReference(56.5, 69)).toBeCloseTo(-50, 6);
  });

  it("no difícil classifica PERFECT (≤ 50), GOOD (≤ 100) e MISS", () => {
    expect(hitForCents(0, HARD)).toBe("perfect");
    expect(hitForCents(-50, HARD)).toBe("perfect");
    expect(hitForCents(51, HARD)).toBe("good");
    expect(hitForCents(100, HARD)).toBe("good");
    expect(hitForCents(101, HARD)).toBe("miss");
  });

  it("no médio os limiares dobram: PERFECT (≤ 100), GOOD (≤ 200) e MISS (sdd-009)", () => {
    expect(hitForCents(75, MEDIUM)).toBe("perfect");
    expect(hitForCents(-100, MEDIUM)).toBe("perfect");
    expect(hitForCents(101, MEDIUM)).toBe("good");
    expect(hitForCents(200, MEDIUM)).toBe("good");
    expect(hitForCents(201, MEDIUM)).toBe("miss");
  });

  it("os limiares do feedback são os da nota: difícil 50/100, médio e fácil 100/200", () => {
    expect(HARD).toEqual({ perfectCents: 50, goodCents: 100 });
    expect(MEDIUM).toEqual({ perfectCents: 100, goodCents: 200 });
    expect(DIFFICULTY_THRESHOLDS.EASY).toEqual(MEDIUM);
  });
});

describe("detectionToMidi", () => {
  it("aceita voz clara dentro da faixa", () => {
    expect(detectionToMidi(440, 0.95, 0.1)).toBeCloseTo(69, 6);
  });

  it("recusa silêncio, pouca clareza e frequência fora da faixa de voz", () => {
    expect(detectionToMidi(440, 0.95, 0.001)).toBeNull();
    expect(detectionToMidi(440, 0.5, 0.1)).toBeNull();
    expect(detectionToMidi(40, 0.95, 0.1)).toBeNull();
    expect(detectionToMidi(2000, 0.95, 0.1)).toBeNull();
    expect(detectionToMidi(Number.NaN, 0.95, 0.1)).toBeNull();
  });
});

describe("framesToTrack", () => {
  it("gera um frame a cada 10 ms com o tamanho da duração", () => {
    const track = framesToTrack([60, null, 62], 100);
    expect(track.version).toBe(1);
    expect(track.hopMs).toBe(10);
    expect(track.durationMs).toBe(100);
    expect(track.midi).toHaveLength(10);
    expect(track.midi.slice(0, 3)).toEqual([60, null, 62]);
    expect(track.midi.slice(3)).toEqual(new Array(7).fill(null));
  });

  it("preserva nulls, corta excedentes e completa faltantes", () => {
    const frames = [60, null, 61, 62, 63, 64];
    const track = framesToTrack(frames, 40);
    expect(track.midi).toEqual([60, null, 61, 62]);
  });

  it("descarta valores fora de [20, 110] e não finitos", () => {
    const track = framesToTrack([10, 120, Number.NaN, 60], 40);
    expect(track.midi).toEqual([null, null, null, 60]);
  });

  it("tem no mínimo 1 frame e no máximo 10 minutos", () => {
    expect(framesToTrack([], 0).midi).toHaveLength(1);
    expect(framesToTrack([], 900_000).durationMs).toBe(600_000);
    expect(framesToTrack([], 900_000).midi).toHaveLength(60_000);
  });

  it("arredonda durações fracionárias", () => {
    expect(framesToTrack([], 1004.6).durationMs).toBe(1005);
    expect(framesToTrack([], 1004.6).midi).toHaveLength(101);
  });
});

describe("meanCentsError", () => {
  it("é null quando a referência não tem voz no trecho", () => {
    expect(meanCentsError([null, null], [60, 60], 0, 2, HARD)).toBeNull();
  });

  it("calcula a média do erro absoluto, dobrando a oitava", () => {
    expect(meanCentsError([69, 69], [69.5, 57], 0, 2, HARD)).toBeCloseTo(25, 6);
  });

  it("conta frame sem voz como erro máximo do nível (o dobro do GOOD: sempre MISS)", () => {
    expect(meanCentsError([69], [null], 0, 1, HARD)).toBe(200);
    expect(meanCentsError([69], [null], 0, 1, MEDIUM)).toBe(400);
    expect(hitForCents(meanCentsError([69], [null], 0, 1, MEDIUM)!, MEDIUM)).toBe("miss");
  });

  it("ignora índices fora dos arrays", () => {
    expect(meanCentsError([69], [69], -5, 50, HARD)).toBe(0);
  });
});

describe("presenceHit (feedback de ritmo do fácil, sdd-009)", () => {
  const voiced = (count: number) => new Array<number | null>(count).fill(60);
  const silent = (count: number) => new Array<number | null>(count).fill(null);

  it("é null quando nem a referência nem a voz têm voz na janela", () => {
    expect(presenceHit(silent(25), silent(25), 0, 25)).toBeNull();
    expect(presenceHit(silent(25), [], 0, 25)).toBeNull();
  });

  it("é ON TIME quando as presenças coincidem, em qualquer tom", () => {
    expect(presenceHit(voiced(25), voiced(25).map(() => 40), 0, 25)).toBe("ontime");
    expect(presenceHit([...voiced(10), ...silent(15)], [...voiced(10), ...silent(15)], 0, 25)).toBe("ontime");
  });

  it("tolera pequenas diferenças na borda (F1 ≥ 0,7)", () => {
    // Referência com voz nos 20 primeiros frames; a pessoa entrou 3 frames depois.
    expect(presenceHit([...voiced(20), ...silent(5)], [...silent(3), ...voiced(17), ...silent(5)], 0, 25)).toBe("ontime");
  });

  it("é MISS quando faltou voz (ficou calado onde a música canta)", () => {
    expect(presenceHit(voiced(25), silent(25), 0, 25)).toBe("miss");
    expect(presenceHit(voiced(25), [...voiced(5), ...silent(20)], 0, 25)).toBe("miss");
  });

  it("é MISS quando sobrou voz (cantou onde a música está em silêncio)", () => {
    expect(presenceHit(silent(25), voiced(25), 0, 25)).toBe("miss");
    expect(presenceHit([...voiced(5), ...silent(20)], voiced(25), 0, 25)).toBe("miss");
  });

  it("ignora índices fora dos arrays", () => {
    expect(presenceHit(voiced(5), voiced(5), -10, 50)).toBe("ontime");
  });
});
