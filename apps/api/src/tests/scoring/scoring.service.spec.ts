import { describe, it, expect } from "vitest";
import { SCORING_CONFIG, scoringService } from "../../services/scoring.service.js";
import type { ScoreResult } from "../../services/scoring.service.js";
import { InvalidReferenceError } from "../../utils/errors.js";
import { lyricLineSchema, pitchTrackSchema } from "../../utils/validators.js";
import {
  addNoise,
  constant,
  delay,
  detuneFrom,
  makeMelody,
  makeTrack,
  randomNotes,
  shiftLines,
  silence,
  transpose,
  truncate,
} from "../helpers/tracks.js";

const SONG_MS = 60_000;
const melody = makeMelody(42, SONG_MS);
const { track: reference, lines } = melody;

function score(sung = reference, songLines = lines, options?: { offsetMs: number }) {
  return scoringService.score(reference, sung, songLines, options);
}

function expectWellFormed(result: ScoreResult) {
  for (const value of [result.score, result.pitchScore, result.timingScore]) {
    expect(Number.isNaN(value)).toBe(false);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(10);
  }
  expect(Number.isNaN(result.keyOffsetSemitones)).toBe(false);
  expect(result.coverage).toBeGreaterThanOrEqual(0);
  expect(result.coverage).toBeLessThanOrEqual(1);
  for (const line of result.lines) {
    expect(line.score).toBeGreaterThanOrEqual(0);
    expect(line.score).toBeLessThanOrEqual(1);
  }
}

describe("scoringService.score — casos sintéticos", () => {
  it("a melodia sintética tem várias linhas e voz", () => {
    expect(lines.length).toBeGreaterThan(10);
    expect(reference.midi.some((value) => value !== null)).toBe(true);
  });

  it("voz idêntica à referência vale 10.0", () => {
    const result = score(reference);
    expect(result.score).toBe(10);
    expect(result.pitchScore).toBe(10);
    expect(result.timingScore).toBe(10);
    expect(result.keyOffsetSemitones).toBe(0);
    expect(result.coverage).toBe(1);
    expect(result.lines).toHaveLength(lines.length);
    expect(result.lines.every((line) => line.onsetDeltaMs === 0 && line.score === 1)).toBe(true);
    expectWellFormed(result);
  });

  it("uma oitava abaixo vale o mesmo que a original", () => {
    const result = score(transpose(reference, -12));
    expect(result.score).toBeGreaterThanOrEqual(9.8);
    expect(result.keyOffsetSemitones).toBe(0);
  });

  it("cantar afinado em outro tom (+3 semitons) não penaliza e detecta a transposição", () => {
    const result = score(transpose(reference, 3));
    expect(result.score).toBeGreaterThanOrEqual(9.8);
    expect(result.keyOffsetSemitones).toBeCloseTo(3, 1);
  });

  it("ruído gaussiano de 30 cents mantém a afinação ≥ 9", () => {
    const result = score(addNoise(reference, 7, 30));
    expect(result.pitchScore).toBeGreaterThanOrEqual(9);
    expectWellFormed(result);
  });

  it("0.75 semitom constante na segunda metade reduz a afinação para o crédito parcial", () => {
    // 75 cents fica no meio da rampa 50→100 cents: cada frame da metade desafinada vale 0.5.
    // Pela fórmula do plano, isso dá afinação ≈ 7.5 (o plano previa 4–7; ver resumo da implementação).
    const result = score(detuneFrom(reference, 0.5, 0.75));
    expect(result.pitchScore).toBeGreaterThanOrEqual(7);
    expect(result.pitchScore).toBeLessThanOrEqual(8);
    expect(result.pitchScore).toBeLessThan(score(reference).pitchScore);
  });

  it("atraso de 100 ms é absorvido e aparece como delta positivo", () => {
    const result = score(delay(reference, 100));
    expect(result.score).toBeGreaterThanOrEqual(9.5);
    expect(result.lines.every((line) => line.onsetDeltaMs === 100)).toBe(true);
  });

  it("atraso de 1 s derruba o tempo", () => {
    const result = score(delay(reference, 1_000));
    expect(result.timingScore).toBeLessThanOrEqual(2);
    expectWellFormed(result);
  });

  it("silêncio total vale 0", () => {
    const result = score(silence(reference));
    expect(result.score).toBe(0);
    expect(result.pitchScore).toBe(0);
    expect(result.timingScore).toBe(0);
    expect(result.coverage).toBe(0);
    expect(result.keyOffsetSemitones).toBe(0);
    expect(result.lines.every((line) => line.onsetDeltaMs === null && line.score === 0)).toBe(true);
    expectWellFormed(result);
  });

  it("notas aleatórias entre 45 e 75 MIDI valem no máximo 3", () => {
    const result = score(randomNotes(99, SONG_MS));
    expect(result.score).toBeLessThanOrEqual(3);
    expectWellFormed(result);
  });

  it("cantar só os primeiros 30% da música vale no máximo 5", () => {
    const result = score(truncate(reference, 0.3));
    expect(result.score).toBeLessThanOrEqual(5);
    expect(result.coverage).toBeLessThan(0.4);
  });

  it("nota monótona sobre melodia variada tem afinação ≤ 3", () => {
    const result = score(constant(reference, 64));
    expect(result.pitchScore).toBeLessThanOrEqual(3);
    expectWellFormed(result);
  });

  it("é determinística", () => {
    const sung = addNoise(reference, 3, 40);
    expect(score(sung)).toEqual(score(sung));
  });
});

describe("scoringService.score — letra", () => {
  it("offsetMs compensa um LRC deslocado", () => {
    const sung = delay(reference, 150);
    const baseline = score(sung, lines);
    const shifted = score(sung, shiftLines(lines, 500), { offsetMs: 500 });

    expect(shifted.timingScore).toBe(baseline.timingScore);
    expect(shifted.lines.map((line) => line.onsetDeltaMs)).toEqual(
      baseline.lines.map((line) => line.onsetDeltaMs),
    );
  });

  it("sem offsetMs, um LRC atrasado além da tolerância derruba o tempo", () => {
    // Voz 150 ms atrasada e letra 700 ms atrasada: delta de -550 ms, já na rampa de desconto.
    const sung = delay(reference, 150);
    const baseline = score(sung, lines);
    const late = score(sung, shiftLines(lines, 700));

    expect(late.timingScore).toBeLessThan(baseline.timingScore);
    expect(score(sung, shiftLines(lines, 700), { offsetMs: 700 }).timingScore).toBe(baseline.timingScore);
  });

  it("linhas sem texto ou sem voz na referência não contam", () => {
    const firstFrame = lines[0]!.startMs / 10;
    const firstPhraseEnd = reference.midi.findIndex((value, frame) => frame > firstFrame && value === null) * 10;
    const withExtras = [
      ...lines,
      { startMs: lines[0]!.startMs - 200, text: "" }, // sem texto, na pausa inicial
      { startMs: firstPhraseEnd + 100, text: "instrumental" }, // na pausa entre a 1ª e a 2ª frase
    ];
    expect(firstPhraseEnd + 100).toBeLessThan(lines[1]!.startMs);

    const result = score(reference, withExtras);
    expect(result.timingScore).toBe(10);
    expect(result.lines).toHaveLength(lines.length);
    expect(result.lines.map((line) => line.index)).toEqual(lines.map((_, index) => index));
  });

  it("linha em que não se cantou nada vale 0 mesmo com onset por perto", () => {
    const first = lines[0]!;
    const second = lines[1]!;
    // Só a primeira linha é cantada; a segunda fica muda.
    const sung = makeTrack(
      reference.midi.map((value, frame) => (frame * 10 >= second.startMs ? null : value)),
    );

    const result = score(sung, [first, second]);
    expect(result.lines[0]?.score).toBe(1);
    expect(result.lines[1]?.score).toBe(0);
    expect(result.timingScore).toBe(5);
  });

  it("sem linhas, o tempo é 0 e a nota fica só com a afinação", () => {
    const result = score(reference, []);
    expect(result.timingScore).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.score).toBe(10 * SCORING_CONFIG.weights.pitch);
  });
});

describe("scoringService.score — erros e limites", () => {
  it("referência sem voz lança InvalidReferenceError (422)", () => {
    const error = (() => {
      try {
        scoringService.score(silence(reference), reference, lines);
      } catch (caught) {
        return caught;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(InvalidReferenceError);
    expect((error as InvalidReferenceError).statusCode).toBe(422);
  });

  it("voz mais curta ou mais longa que a referência não quebra", () => {
    const shorter = makeTrack(reference.midi.slice(0, reference.midi.length / 2));
    const longer = makeTrack([...reference.midi, ...reference.midi]);

    expectWellFormed(score(shorter));
    expect(score(longer).score).toBe(10);
  });

  it("pontua 10 minutos (60 mil frames) em menos de 50 ms", () => {
    const long = makeMelody(1, 600_000);
    expect(long.track.midi).toHaveLength(60_000);

    scoringService.score(long.track, long.track, long.lines); // aquece o JIT

    const sung = addNoise(long.track, 5, 20);
    const started = performance.now();
    const result = scoringService.score(long.track, sung, long.lines);
    const elapsed = performance.now() - started;

    expect(result.score).toBeGreaterThan(9);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("schemas", () => {
  it("pitchTrackSchema aceita o formato do worker", () => {
    expect(pitchTrackSchema.safeParse(reference).success).toBe(true);
  });

  it("pitchTrackSchema recusa versão, hop, MIDI fora da faixa e track vazio", () => {
    expect(pitchTrackSchema.safeParse({ ...reference, version: 2 }).success).toBe(false);
    expect(pitchTrackSchema.safeParse({ ...reference, hopMs: 20 }).success).toBe(false);
    expect(pitchTrackSchema.safeParse({ ...reference, midi: [200] }).success).toBe(false);
    expect(pitchTrackSchema.safeParse({ ...reference, midi: [] }).success).toBe(false);
  });

  it("lyricLineSchema exige startMs inteiro não negativo", () => {
    expect(lyricLineSchema.safeParse({ startMs: 0, text: "" }).success).toBe(true);
    expect(lyricLineSchema.safeParse({ startMs: -1, text: "x" }).success).toBe(false);
    expect(lyricLineSchema.safeParse({ startMs: 1.5, text: "x" }).success).toBe(false);
  });
});
