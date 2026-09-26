import { InvalidReferenceError } from "../utils/errors.js";
import { findOnset, fold12, median } from "../utils/pitch.js";
import type { LyricLine, PitchTrack } from "../utils/validators.js";

/**
 * Constantes de calibração da nota. Centralizadas para o ajuste manual previsto em
 * `specs/sdd-002-scoring/tasks.md` §7 (gravações reais: boa ≥ 7, ruim ≤ 4).
 */
export const SCORING_CONFIG = {
  weights: { pitch: 0.7, timing: 0.3 },
  pitch: {
    /** Erro até aqui (em cents) vale acerto cheio. */
    fullCreditCents: 50,
    /** A partir daqui o frame vale zero; entre os dois, crédito linear. */
    zeroCreditCents: 100,
    /** Frames para cada lado onde se procura a melhor nota cantada (±150 ms). */
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
  /** 0..10, 1 casa decimal. */
  score: number;
  /** 0..10, 1 casa decimal. */
  pitchScore: number;
  /** 0..10, 1 casa decimal. */
  timingScore: number;
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
}

type Frames = readonly (number | null)[];

/**
 * Nota de cantoria (0 a 10) a partir de duas curvas de pitch e das linhas da letra.
 *
 * Função pura e determinística, sem I/O. Algoritmo em `specs/sdd-002-scoring/tasks.md` §3:
 * afinação (módulo oitava, tom compensado, busca em janela local) pesa 70% e entrada no
 * tempo de cada linha pesa 30%.
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

    if (!ref.some((value) => value !== null)) {
      throw new InvalidReferenceError();
    }

    // 1. Alinhamento: a voz é lida na mesma grade da referência; o que passa do tamanho
    //    da referência é ignorado e o que falta conta como silêncio.
    const limit = Math.min(ref.length, voice.length);
    const hopMs = reference.hopMs;

    // 2. Tom
    const keyOffset = detectKeyOffset(ref, voice, limit);

    // 3–4. Afinação
    const { pitch, coverage } = scorePitch(ref, voice, limit, keyOffset);

    // 5. Entrada no tempo
    const { timing, lineResults } = scoreTiming(
      ref,
      voice,
      hopMs,
      lines,
      options.offsetMs ?? 0,
    );

    // 6. Nota final
    const { weights } = SCORING_CONFIG;
    const total = weights.pitch * pitch + weights.timing * timing;

    return {
      score: toScore10(total),
      pitchScore: toScore10(pitch),
      timingScore: toScore10(timing),
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
): { pitch: number; coverage: number } {
  const { fullCreditCents, zeroCreditCents, searchWindowFrames, minCoverageForFullCredit } =
    SCORING_CONFIG.pitch;

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

    const onsetFrame = findOnset(
      voice,
      Math.round((current.startMs - zeroCreditMs) / hopMs),
      Math.round((current.startMs + zeroCreditMs) / hopMs),
      minOnsetFrames,
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
