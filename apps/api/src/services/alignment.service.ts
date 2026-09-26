import { voicedSegments } from "../utils/pitch.js";
import type { LyricLine, LyricsAlignment, PitchTrack } from "../utils/validators.js";

/**
 * Constantes do alinhamento da letra à referência. Tudo em ms sobre a grade de 10 ms do
 * `PitchTrack`. Algoritmo e critérios em `specs/sdd-007-lyrics-alignment/tasks.md` §3.
 */
export const ALIGNMENT_CONFIG = {
  segment: {
    /** Buracos sem voz até aqui não quebram a frase (consoante, respiração curta). */
    mergeGapMs: 250,
    /** Trechos com voz mais curtos que isto são ruído. */
    minSegmentMs: 80,
    /** Silêncio mínimo antes de um trecho para ele contar como início de frase (onset). */
    minSilenceBeforeOnsetMs: 350,
  },
  shift: {
    /** Deslocamento global procurado em ±12 s: cobre os 10 s de tolerância de duração mais folga. */
    searchRangeMs: 12_000,
    stepMs: 10,
    /** Linha a até isto de um onset contribui para o deslocamento (crédito linear até zero). */
    toleranceMs: 400,
    /** Abaixo desta fração de linhas encaixadas, o alinhamento é recusado (`aligned: false`). */
    minMatchedRatio: 0.5,
    /** Menos linhas com texto (ou menos onsets) que isto → não há o que alinhar. */
    minLines: 3,
  },
  snap: {
    /** Linha com onset livre a até isto encaixa nele. */
    toleranceMs: 350,
    /** Distância mínima entre duas linhas consecutivas depois do alinhamento. */
    minLineGapMs: 200,
  },
} as const;

export interface AlignmentResult extends LyricsAlignment {
  /** Letra alinhada, ou `null` quando `aligned` é `false`. */
  lines: LyricLine[] | null;
}

const NOT_ALIGNED: AlignmentResult = { aligned: false, shiftMs: 0, matchedRatio: 0, lines: null };

/**
 * Alinha a letra sincronizada (cronometrada em cima de outra gravação) ao áudio da referência.
 *
 * Função pura e determinística: mesma letra + mesma referência → mesmo resultado. Só desloca
 * as linhas — **nunca muda a velocidade da letra** (sem escala de andamento, decisão do usuário
 * em `specs/sdd-007-lyrics-alignment/tasks.md` §2). Passos:
 *
 * 1. trechos com voz → inícios de frase (onsets: trecho precedido de silêncio ≥ 350 ms);
 * 2. deslocamento global por varredura em ±12 s (maximiza a proximidade linha ↔ onset);
 * 3. cada linha com texto que tenha um onset livre a até 350 ms encaixa nele (um onset por
 *    linha); as demais ficam só com o deslocamento global;
 * 4. ordem crescente garantida (≥ 200 ms entre linhas) e limites do áudio respeitados.
 *
 * Menos da metade das linhas com texto encaixadas → `aligned: false` e `lines: null`: um
 * deslocamento errado é pior que nenhum, então o consumidor volta para a letra original.
 */
export const alignmentService = {
  align(lines: LyricLine[], reference: PitchTrack): AlignmentResult {
    const { segment, shift, snap } = ALIGNMENT_CONFIG;

    const onsets = phraseOnsets(reference, segment.mergeGapMs, segment.minSegmentMs, segment.minSilenceBeforeOnsetMs);
    const textLines = lines.filter((line) => hasText(line));
    if (textLines.length < shift.minLines || onsets.length < shift.minLines) return NOT_ALIGNED;

    const shiftMs = bestShift(textLines, onsets, shift.searchRangeMs, shift.stepMs, shift.toleranceMs);

    const used = new Array<boolean>(onsets.length).fill(false);
    const aligned: LyricLine[] = [];
    let matched = 0;
    let previous: number | null = null;

    for (const line of lines) {
      let startMs = line.startMs + shiftMs;

      if (hasText(line)) {
        const index = nearestFreeOnset(onsets, used, startMs, snap.toleranceMs);
        if (index !== null) {
          used[index] = true;
          startMs = onsets[index] ?? startMs;
          matched++;
        }
      }

      if (previous !== null) startMs = Math.max(startMs, previous + snap.minLineGapMs);
      startMs = Math.min(reference.durationMs, Math.max(0, startMs));
      previous = startMs;

      aligned.push({ startMs, text: line.text });
    }

    const matchedRatio = round3(matched / textLines.length);
    const isAligned = matchedRatio >= shift.minMatchedRatio;

    return { aligned: isAligned, shiftMs, matchedRatio, lines: isAligned ? aligned : null };
  },
};

function hasText(line: LyricLine): boolean {
  return line.text.trim() !== "";
}

/** Inícios de frase (ms, crescente): trechos com voz precedidos de silêncio suficiente. */
function phraseOnsets(reference: PitchTrack, mergeGapMs: number, minSegmentMs: number, minSilenceMs: number): number[] {
  const segments = voicedSegments(reference.midi, reference.hopMs, mergeGapMs, minSegmentMs);
  const onsets: number[] = [];

  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    if (current === undefined) continue;
    const previous = segments[i - 1];
    if (previous === undefined || current.startMs - previous.endMs >= minSilenceMs) {
      onsets.push(current.startMs);
    }
  }

  return onsets;
}

/**
 * Deslocamento global que maximiza Σ crédito(distância da linha ao onset mais próximo),
 * com crédito linear de 1 (em cima) a 0 (a `toleranceMs`). Empate → menor |d|.
 */
function bestShift(lines: LyricLine[], onsets: number[], rangeMs: number, stepMs: number, toleranceMs: number): number {
  let bestScore = Number.NEGATIVE_INFINITY;
  let best = 0;

  for (let d = -rangeMs; d <= rangeMs; d += stepMs) {
    let score = 0;
    for (const line of lines) {
      const distance = distanceToNearest(onsets, line.startMs + d);
      if (distance < toleranceMs) score += 1 - distance / toleranceMs;
    }

    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && Math.abs(d) < Math.abs(best))) {
      bestScore = score;
      best = d;
    }
  }

  return best;
}

/** Distância (ms) de `t` ao onset mais próximo. `onsets` crescente e não vazio. */
function distanceToNearest(onsets: number[], t: number): number {
  const index = lowerBound(onsets, t);
  const after = onsets[index];
  const before = onsets[index - 1];
  const distanceAfter = after === undefined ? Number.POSITIVE_INFINITY : after - t;
  const distanceBefore = before === undefined ? Number.POSITIVE_INFINITY : t - before;
  return Math.min(distanceAfter, distanceBefore);
}

/** Índice do onset livre mais próximo de `t` a até `toleranceMs`, ou `null`. */
function nearestFreeOnset(onsets: number[], used: boolean[], t: number, toleranceMs: number): number | null {
  const index = lowerBound(onsets, t);
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = index; i < onsets.length; i++) {
    const onset = onsets[i];
    if (onset === undefined || onset - t > toleranceMs) break;
    if (!used[i] && onset - t < bestDistance) {
      best = i;
      bestDistance = onset - t;
    }
  }
  for (let i = index - 1; i >= 0; i--) {
    const onset = onsets[i];
    if (onset === undefined || t - onset > toleranceMs) break;
    if (!used[i] && t - onset < bestDistance) {
      best = i;
      bestDistance = t - onset;
    }
  }

  return best;
}

/** Primeiro índice com `values[i] >= t` (busca binária em array crescente). */
function lowerBound(values: number[], t: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] ?? Number.POSITIVE_INFINITY) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
