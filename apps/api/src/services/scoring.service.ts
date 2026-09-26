import { InvalidReferenceError } from "../utils/errors.js";
import { findOnset, fold12, median } from "../utils/pitch.js";
import type { Difficulty, LyricLine, PitchTrack } from "../utils/validators.js";

/** Limiares de afinação e pesos de um nível (sdd-009). */
export interface DifficultyLevel {
  pitch: {
    /** Erro até aqui (em cents) vale acerto cheio. */
    fullCreditCents: number;
    /** A partir daqui o frame vale zero; entre os dois, crédito linear. */
    zeroCreditCents: number;
  };
  /** Somam 1. `total = pitch·afinação + timing·tempo + rhythm·ritmo`. */
  weights: { pitch: number; timing: number; rhythm: number };
}

/**
 * Constantes de calibração da nota. Centralizadas para o ajuste manual previsto em
 * `specs/sdd-002-scoring/tasks.md` §7 (gravações reais: boa ≥ 7, ruim ≤ 4). Os limiares de
 * afinação e os pesos variam por nível (`levels`, sdd-009); o resto vale para os três.
 */
export const SCORING_CONFIG = {
  /** Nível usado quando a chamada não informa um (comportamento dos clientes antigos). */
  defaultDifficulty: "HARD" as Difficulty,
  levels: {
    /** Meio semitom de folga; afinação e tempo pesam igual. */
    HARD: { pitch: { fullCreditCents: 50, zeroCreditCents: 100 }, weights: { pitch: 0.5, timing: 0.5, rhythm: 0 } },
    /** Um semitom de folga; o ritmo passa a contar. */
    MEDIUM: { pitch: { fullCreditCents: 100, zeroCreditCents: 200 }, weights: { pitch: 0.5, timing: 0.25, rhythm: 0.25 } },
    /** Sem afinação: só letra no tempo e ritmo. A afinação é calculada, mas informativa. */
    EASY: { pitch: { fullCreditCents: 100, zeroCreditCents: 200 }, weights: { pitch: 0, timing: 0.5, rhythm: 0.5 } },
  } satisfies Record<Difficulty, DifficultyLevel>,
  pitch: {
    /** Frames para cada lado onde se procura a melhor nota cantada (±150 ms). Também é a folga do ritmo. */
    searchWindowFrames: 15,
    /** Abaixo desta cobertura, a afinação é reduzida proporcionalmente. */
    minCoverageForFullCredit: 0.6,
    /** Compensa cantar em outro tom (mediana da diferença módulo 12). */
    allowTransposition: true,
  },
  timing: {
    /** Entrada até aqui (em ms, para mais ou para menos) vale acerto cheio. */
    fullCreditMs: 400,
    /** A partir daqui a linha vale zero; também é a meia-janela de busca do onset. */
    zeroCreditMs: 800,
    /** Frames contínuos com voz para contar como onset (50 ms). */
    minOnsetFrames: 5,
    /** Fração mínima da voz da referência que precisa ter sido cantada na linha. */
    minLinePresence: 0.25,
    /** Duração assumida da última linha (não há linha seguinte para delimitar). */
    lastLineDurationMs: 5_000,
  },
} as const;

export interface LineResult {
  /** Posição da linha no array recebido. */
  index: number;
  /** `startMs` original da linha (sem o `offsetMs`). */
  startMs: number;
  /** Entrada em relação à letra: + = atrasado, - = adiantado, `null` = não cantou. */
  onsetDeltaMs: number | null;
  /** 0..1 */
  score: number;
}

export interface ScoreResult {
  /** 0..10, 1 casa decimal, com os pesos do nível. */
  score: number;
  /** 0..10, 1 casa decimal. Calculada em todos os níveis; no `EASY` não entra na nota. */
  pitchScore: number;
  /** 0..10, 1 casa decimal. */
  timingScore: number;
  /**
   * 0..10, 1 casa decimal: F1 entre a presença de voz cantada e a da referência com folga
   * de ±150 ms (sdd-009). Calculado em todos os níveis; pesa no `EASY` e no `MEDIUM`.
   */
  rhythmScore: number;
  /** Nível com que a nota foi calculada. */
  difficulty: Difficulty;
  /** Transposição detectada em semitons, em [-6, 6). Ex.: -2 = cantou 2 semitons abaixo. */
  keyOffsetSemitones: number;
  /** Fração dos frames com voz na referência que tiveram voz cantada na janela de busca. */
  coverage: number;
  /** Só as linhas que contam para o tempo (com texto e com voz na referência). */
  lines: LineResult[];
}

export interface ScoreOptions {
  /**
   * Ajuste manual do LRC: quanto a letra está *atrasada* em relação ao áudio, em ms.
   * Cada linha é avaliada em `startMs - offsetMs`. Não mexe nas curvas de pitch: a voz
   * é gravada sobre a própria referência, então as duas já compartilham a linha do tempo.
   */
  offsetMs?: number;
  /** Nível da nota (sdd-009). Padrão `HARD`. */
  difficulty?: Difficulty;
}

type Frames = readonly (number | null)[];

/**
 * Nota de cantoria (0 a 10) a partir de duas curvas de pitch e das linhas da letra.
 *
 * Função pura e determinística, sem I/O. Algoritmo em `specs/sdd-002-scoring/tasks.md` §3:
 * afinação (módulo oitava, tom compensado, busca em janela local), entrada no tempo de cada
 * linha e ritmo (presença de voz nos lugares certos), combinados com os pesos do nível
 * (`SCORING_CONFIG.levels`, `specs/sdd-009-difficulty-levels/tasks.md` §3).
 */
export const scoringService = {
  score(
    reference: PitchTrack,
    sung: PitchTrack,
    lines: LyricLine[],
    options: ScoreOptions = {},
  ): ScoreResult {
    const ref = reference.midi;
    const voice = sung.midi;
    const difficulty = options.difficulty ?? SCORING_CONFIG.defaultDifficulty;
    const level: DifficultyLevel = SCORING_CONFIG.levels[difficulty];

    if (!ref.some((value) => value !== null)) {
      throw new InvalidReferenceError();
    }

    // 1. Alinhamento: a voz é lida na mesma grade da referência; o que passa do tamanho
    //    da referência é ignorado e o que falta conta como silêncio.
    const limit = Math.min(ref.length, voice.length);
    const hopMs = reference.hopMs;

    // 2. Tom
    const keyOffset = detectKeyOffset(ref, voice, limit);

    // 3–4. Afinação (limiares do nível) e cobertura
    const { pitch, coverage } = scorePitch(ref, voice, limit, keyOffset, level.pitch);

    // 5. Entrada no tempo
    const { timing, lineResults } = scoreTiming(
      ref,
      voice,
      hopMs,
      lines,
      options.offsetMs ?? 0,
    );

    // 6. Ritmo: a cobertura já é o recall; falta só a precisão.
    const rhythm = scoreRhythm(ref, voice, limit, coverage);

    // 7. Nota final com os pesos do nível
    const { weights } = level;
    const total = weights.pitch * pitch + weights.timing * timing + weights.rhythm * rhythm;

    return {
      score: toScore10(total),
      pitchScore: toScore10(pitch),
      timingScore: toScore10(timing),
      rhythmScore: toScore10(rhythm),
      difficulty,
      keyOffsetSemitones: round(keyOffset, 2),
      coverage: clamp01(coverage),
      lines: lineResults,
    };
  },
};

/** Mediana de `fold12(voz - referência)` nos frames com voz dos dois lados. */
function detectKeyOffset(ref: Frames, voice: Frames, limit: number): number {
  if (!SCORING_CONFIG.pitch.allowTransposition) return 0;

  const differences: number[] = [];
  for (let i = 0; i < limit; i++) {
    const r = ref[i];
    const s = voice[i];
    if (r == null || s == null) continue;
    differences.push(fold12(s - r));
  }

  return median(differences);
}

function scorePitch(
  ref: Frames,
  voice: Frames,
  limit: number,
  keyOffset: number,
  thresholds: DifficultyLevel["pitch"],
): { pitch: number; coverage: number } {
  const { fullCreditCents, zeroCreditCents } = thresholds;
  const { searchWindowFrames, minCoverageForFullCredit } = SCORING_CONFIG.pitch;

  let referenceVoiced = 0;
  let covered = 0;
  let creditSum = 0;

  for (let i = 0; i < ref.length; i++) {
    const r = ref[i];
    if (r == null) continue;
    referenceVoiced++;

    const from = Math.max(0, i - searchWindowFrames);
    const to = Math.min(limit - 1, i + searchWindowFrames);
    let bestCents = Number.POSITIVE_INFINITY;

    for (let j = from; j <= to; j++) {
      const s = voice[j];
      if (s == null) continue;
      const cents = Math.abs(fold12(s - r - keyOffset)) * 100;
      if (cents < bestCents) {
        bestCents = cents;
        if (cents <= fullCreditCents) break; // já é acerto cheio
      }
    }

    if (bestCents === Number.POSITIVE_INFINITY) continue; // sem voz cantada na janela

    covered++;
    creditSum += ramp(bestCents, fullCreditCents, zeroCreditCents);
  }

  if (referenceVoiced === 0 || covered === 0) return { pitch: 0, coverage: 0 };

  const accuracy = creditSum / covered;
  const coverage = covered / referenceVoiced;
  const coveragePenalty = Math.min(1, coverage / minCoverageForFullCredit);

  return { pitch: accuracy * coveragePenalty, coverage };
}

/**
 * Ritmo (sdd-009): F1 entre "cantou onde a referência tem voz" (recall = `coverage`, que a
 * afinação já calculou com a mesma folga de ±150 ms) e "a referência tem voz onde cantou"
 * (precisão). Uma varredura em O(n) sobre a voz, com soma acumulada da referência.
 * Independe do tom: falar a letra no lugar certo vale 1; cantar sem parar vale a fração de
 * voz da referência; ficar calado vale 0.
 */
function scoreRhythm(ref: Frames, voice: Frames, limit: number, recall: number): number {
  if (recall <= 0 || limit === 0) return 0;

  const { searchWindowFrames } = SCORING_CONFIG.pitch;

  // voicedBefore[i] = nº de frames da referência com voz em [0, i)
  const voicedBefore = new Uint32Array(ref.length + 1);
  for (let i = 0; i < ref.length; i++) {
    voicedBefore[i + 1] = (voicedBefore[i] ?? 0) + (ref[i] == null ? 0 : 1);
  }

  let sungVoiced = 0;
  let matched = 0;
  for (let j = 0; j < limit; j++) {
    if (voice[j] == null) continue;
    sungVoiced++;
    const from = Math.max(0, j - searchWindowFrames);
    const to = Math.min(ref.length, j + searchWindowFrames + 1);
    if ((voicedBefore[to] ?? 0) - (voicedBefore[from] ?? 0) > 0) matched++;
  }

  if (sungVoiced === 0) return 0;
  const precision = matched / sungVoiced;
  if (precision <= 0) return 0;

  return (2 * recall * precision) / (recall + precision);
}

function scoreTiming(
  ref: Frames,
  voice: Frames,
  hopMs: number,
  lines: LyricLine[],
  offsetMs: number,
): { timing: number; lineResults: LineResult[] } {
  const { fullCreditMs, zeroCreditMs, minOnsetFrames, minLinePresence, lastLineDurationMs } =
    SCORING_CONFIG.timing;
  const totalFrames = ref.length;

  // Ordena por instante efetivo para delimitar cada linha pela seguinte, mas preserva o
  // índice original para o resultado.
  const ordered = lines
    .map((line, index) => ({ index, line, startMs: line.startMs - offsetMs }))
    .sort((a, b) => a.startMs - b.startMs);

  const lineResults: LineResult[] = [];
  let scoreSum = 0;

  for (let k = 0; k < ordered.length; k++) {
    const current = ordered[k];
    if (current === undefined) continue;
    if (current.line.text.trim() === "") continue; // linha sem texto (instrumental)

    const next = ordered[k + 1];
    const startFrame = clampFrame(Math.round(current.startMs / hopMs), totalFrames);
    const endFrame = clampFrame(
      next === undefined
        ? startFrame + Math.round(lastLineDurationMs / hopMs)
        : Math.round(next.startMs / hopMs),
      totalFrames,
    );

    const referenceVoiced = countVoiced(ref, startFrame, endFrame);
    if (referenceVoiced === 0) continue; // sem voz na referência (instrumental)

    // O onset mais próximo do instante da linha, não o primeiro da janela: o rabo da linha
    // anterior chega aqui com falhas curtas de detecção que também parecem "inícios".
    const onsetFrame = findOnset(
      voice,
      Math.round((current.startMs - zeroCreditMs) / hopMs),
      Math.round((current.startMs + zeroCreditMs) / hopMs),
      minOnsetFrames,
      Math.round(current.startMs / hopMs),
    );
    const onsetDeltaMs = onsetFrame === null ? null : onsetFrame * hopMs - current.startMs;
    const onsetScore = onsetDeltaMs === null ? 0 : ramp(Math.abs(onsetDeltaMs), fullCreditMs, zeroCreditMs);

    const presence = countVoiced(voice, startFrame, endFrame) / referenceVoiced;
    const score = presence >= minLinePresence ? onsetScore : 0;

    scoreSum += score;
    lineResults.push({ index: current.index, startMs: current.line.startMs, onsetDeltaMs, score });
  }

  lineResults.sort((a, b) => a.index - b.index);

  return {
    timing: lineResults.length === 0 ? 0 : scoreSum / lineResults.length,
    lineResults,
  };
}

/** 1 até `full`, 0 a partir de `zero`, linear entre os dois. */
function ramp(value: number, full: number, zero: number): number {
  if (value <= full) return 1;
  if (value >= zero) return 0;
  return 1 - (value - full) / (zero - full);
}

function countVoiced(track: Frames, fromFrame: number, toFrame: number): number {
  const end = Math.min(toFrame, track.length);
  let count = 0;
  for (let i = Math.max(0, fromFrame); i < end; i++) {
    if (track[i] != null) count++;
  }
  return count;
}

function clampFrame(frame: number, totalFrames: number): number {
  return Math.min(totalFrames, Math.max(0, frame));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Fração 0..1 → nota 0..10 com 1 casa decimal. */
function toScore10(fraction: number): number {
  return round(10 * clamp01(fraction), 1);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded; // evita -0
}
