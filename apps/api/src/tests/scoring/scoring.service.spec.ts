import { describe, it, expect } from "vitest";
import { SCORING_CONFIG, scoringService } from "../../services/scoring.service.js";
import type { ScoreOptions, ScoreResult } from "../../services/scoring.service.js";
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

function score(sung = reference, songLines = lines, options?: ScoreOptions) {
  return scoringService.score(reference, sung, songLines, options);
}

/**
 * Desafina o primeiro terço para cima e o último para baixo, deixando o meio no lugar: a
 * mediana das diferenças fica em 0, então a compensação de tom não anula o erro (dois
 * terços dos frames ficam `semitones` fora).
 */
function detuneEdges(track: typeof reference, semitones: number) {
  const total = track.midi.length;
  return makeTrack(
    track.midi.map((value, frame) => {
      if (value === null) return null;
      if (frame < total / 3) return Math.round((value + semitones) * 100) / 100;
      if (frame >= (2 * total) / 3) return Math.round((value - semitones) * 100) / 100;
      return value;
    }),
  );
}

function expectWellFormed(result: ScoreResult) {
  for (const value of [result.score, result.pitchScore, result.timingScore, result.rhythmScore]) {
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
    expect(result.rhythmScore).toBe(10);
    expect(result.difficulty).toBe("HARD");
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
    expect(result.rhythmScore).toBe(0);
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

  it("um reinício curto no rabo da linha anterior não vira a entrada da linha", () => {
    // Voz 100 ms atrasada e, antes das linhas cuja pausa anterior é longa o bastante, um
    // "reinício" de 50 ms 600 ms antes do verso, cercado de silêncio: falha de detecção
    // típica no fim da frase anterior. O onset da linha tem de continuar sendo a entrada
    // real (+100 ms), e não o reinício (-600 ms, que valeria 0,5).
    const sung = delay(reference, 100);
    const midi = [...sung.midi];
    let blips = 0;
    for (const line of lines.slice(1)) {
      const blipStart = line.startMs / 10 - 60;
      const quiet = midi.slice(blipStart - 5, blipStart + 10).every((value) => value === null);
      if (!quiet) continue;
      for (let frame = blipStart; frame < blipStart + 5; frame++) midi[frame] = 64;
      blips++;
    }
    expect(blips).toBeGreaterThan(3);

    const result = score(makeTrack(midi));
    expect(result.lines.every((line) => line.onsetDeltaMs === 100 && line.score === 1)).toBe(true);
    expect(result.timingScore).toBe(10);
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

  it("sem linhas, o tempo é 0 e a nota fica só com a afinação (e o ritmo, se pesar)", () => {
    const result = score(reference, []);
    expect(result.timingScore).toBe(0);
    expect(result.lines).toEqual([]);
    // HARD: 0,5·afinação + 0,5·tempo (sdd-009 mudou de 0,7/0,3).
    expect(result.score).toBe(10 * SCORING_CONFIG.levels.HARD.weights.pitch);
  });
});

describe("scoringService.score — níveis (sdd-009)", () => {
  const hard = { difficulty: "HARD" } as const;
  const medium = { difficulty: "MEDIUM" } as const;
  const easy = { difficulty: "EASY" } as const;

  describe("padrão", () => {
    it("sem difficulty, o resultado é idêntico ao HARD", () => {
      const sung = addNoise(reference, 3, 60);
      expect(score(sung)).toEqual(score(sung, lines, hard));
      expect(score(sung).difficulty).toBe("HARD");
    });

    it("os pesos de cada nível somam 1", () => {
      for (const level of Object.values(SCORING_CONFIG.levels)) {
        const { pitch, timing, rhythm } = level.weights;
        expect(pitch + timing + rhythm).toBeCloseTo(1, 10);
      }
    });
  });

  describe("HARD", () => {
    it("mantém os limiares de afinação (50/100 cents) com pesos 0,5/0,5", () => {
      expect(SCORING_CONFIG.levels.HARD.pitch).toEqual({ fullCreditCents: 50, zeroCreditCents: 100 });
      expect(SCORING_CONFIG.levels.HARD.weights).toEqual({ pitch: 0.5, timing: 0.5, rhythm: 0 });
    });

    it("75 cents fora (sem compensação de tom) vale afinação entre 5 e 7", () => {
      // Dois terços dos frames caem no meio da rampa 50→100 (0,5 cada); o terço do meio vale 1.
      const result = score(detuneEdges(reference, 0.75), lines, hard);
      expect(result.keyOffsetSemitones).toBe(0);
      expect(result.pitchScore).toBeGreaterThanOrEqual(5);
      expect(result.pitchScore).toBeLessThanOrEqual(7);
    });

    it("o ritmo é calculado mas não pesa: cantar tudo sem parar não muda a nota", () => {
      const result = score(randomNotes(99, SONG_MS), lines, hard);
      expect(result.rhythmScore).toBeGreaterThan(0);
      expect(result.score).toBeCloseTo(0.5 * result.pitchScore + 0.5 * result.timingScore, 0);
    });
  });

  describe("MEDIUM", () => {
    it("cantar a própria referência vale 10 (afinação, tempo e ritmo 10)", () => {
      const result = score(reference, lines, medium);
      expect(result).toMatchObject({ score: 10, pitchScore: 10, timingScore: 10, rhythmScore: 10, difficulty: "MEDIUM" });
    });

    it("75 cents fora vale afinação 10 (no difícil fica entre 5 e 7)", () => {
      const sung = detuneEdges(reference, 0.75);
      expect(score(sung, lines, medium).pitchScore).toBe(10);
      expect(score(sung, lines, hard).pitchScore).toBeLessThanOrEqual(7);
    });

    it("150 cents fora vale afinação ≈ 6,7 (meio da rampa 100→200 em dois terços dos frames)", () => {
      const result = score(detuneEdges(reference, 1.5), lines, medium);
      expect(result.pitchScore).toBeGreaterThanOrEqual(6);
      expect(result.pitchScore).toBeLessThanOrEqual(7.5);
    });

    it("250 cents fora zera os frames desafinados nos dois níveis", () => {
      const sung = detuneEdges(reference, 2.5);
      // Só o terço do meio (no lugar) pontua, mais o que a janela de ±150 ms acha nas
      // bordas das frases: ≈ 3,3 a 4,5 nos dois níveis.
      for (const options of [medium, hard]) {
        const result = score(sung, lines, options);
        expect(result.pitchScore).toBeGreaterThanOrEqual(2.5);
        expect(result.pitchScore).toBeLessThanOrEqual(5);
      }
    });

    it("nota fixa errada no ritmo certo: tempo 10, ritmo 10 e a nota fica em 0,5·afinação + 5", () => {
      const result = score(constant(reference, 40), lines, medium);
      expect(result.timingScore).toBe(10);
      expect(result.rhythmScore).toBe(10);
      expect(result.pitchScore).toBeLessThan(5);
      expect(result.score).toBeCloseTo(0.5 * result.pitchScore + 5, 0);
    });

    it("cantar em outro tom continua compensado", () => {
      const result = score(transpose(reference, 5), lines, medium);
      expect(result.score).toBeGreaterThanOrEqual(9.8);
      expect(result.keyOffsetSemitones).toBeCloseTo(5, 1);
    });
  });

  describe("EASY", () => {
    it("cantar a própria referência vale 10", () => {
      const result = score(reference, lines, easy);
      expect(result).toMatchObject({ score: 10, timingScore: 10, rhythmScore: 10, difficulty: "EASY" });
    });

    it("transposta 5 semitons vale 10", () => {
      expect(score(transpose(reference, 5), lines, easy).score).toBe(10);
    });

    it("nota fixa errada no ritmo certo vale 10 no fácil e menos de 6,5 no difícil", () => {
      const sung = constant(reference, 40);
      expect(score(sung, lines, easy).score).toBe(10);
      expect(score(sung, lines, hard).score).toBeLessThan(6.5);
    });

    it("a afinação é calculada (informativa) mas não pesa na nota", () => {
      const result = score(constant(reference, 40), lines, easy);
      expect(result.pitchScore).toBeLessThan(10);
      expect(result.score).toBe(10);
    });

    it("cantar sem parar: tempo ≈ 0 (sem onsets) e a nota fica só com a precisão do ritmo", () => {
      // A melodia sintética quase não tem silêncio (pausas de 500–900 ms, e a folga de
      // ±150 ms cobre parte delas), então a precisão fica alta (≈ 0,9). Numa música real,
      // com intro e pausas longas, a precisão cai para a fração de voz (~0,6): ver o caso
      // seguinte, com silêncio na referência.
      const result = score(randomNotes(99, SONG_MS), lines, easy);
      expect(result.timingScore).toBeLessThanOrEqual(1);
      expect(result.rhythmScore).toBeGreaterThanOrEqual(6);
      expect(result.rhythmScore).toBeLessThanOrEqual(9.5);
      expect(result.score).toBeLessThan(5);
    });

    it("falar por cima de uma música com metade de silêncio: ritmo ≈ 6,7 (precisão 0,5) e nota < 4", () => {
      // Referência com a segunda metade muda; a pessoa fala do começo ao fim.
      const half = truncate(reference, 0.5);
      const result = scoringService.score(half, randomNotes(99, SONG_MS), lines, easy);
      expect(result.timingScore).toBeLessThanOrEqual(1);
      expect(result.rhythmScore).toBeGreaterThanOrEqual(6);
      expect(result.rhythmScore).toBeLessThanOrEqual(7.5);
      expect(result.score).toBeLessThan(4);
    });

    it("silêncio vale 0", () => {
      const result = score(silence(reference), lines, easy);
      expect(result.score).toBe(0);
      expect(result.rhythmScore).toBe(0);
    });

    it("cantar só a primeira metade: ritmo ≈ 6,7 (recall 0,5, precisão 1) e tempo ≈ 5", () => {
      const result = score(truncate(reference, 0.5), lines, easy);
      expect(result.rhythmScore).toBeGreaterThanOrEqual(6);
      expect(result.rhythmScore).toBeLessThanOrEqual(7.5);
      expect(result.timingScore).toBeGreaterThanOrEqual(4);
      expect(result.timingScore).toBeLessThanOrEqual(6);
      expect(result.score).toBeCloseTo(0.5 * result.timingScore + 0.5 * result.rhythmScore, 0);
    });
  });

  describe("ritmo", () => {
    it("um atraso de 100 ms (dentro da folga de ±150 ms) mantém o ritmo 10", () => {
      expect(score(delay(reference, 100), lines, easy).rhythmScore).toBe(10);
    });

    it("cantar sem parar vale a fração de voz da referência como precisão", () => {
      const voiced = reference.midi.filter((value) => value !== null).length / reference.midi.length;
      const expectedF1 = (2 * voiced) / (1 + voiced); // recall 1
      const result = score(randomNotes(7, SONG_MS), lines, easy);
      // A folga de ±150 ms conta como acerto os frames colados nas frases: um pouco acima do F1 cru.
      expect(result.rhythmScore).toBeGreaterThanOrEqual(10 * expectedF1 - 0.5);
      expect(result.rhythmScore).toBeLessThanOrEqual(10 * expectedF1 + 2);
    });
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
