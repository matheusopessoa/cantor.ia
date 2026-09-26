import { median, voicedSegments } from "../utils/pitch.js";
import type {
  ForcedAlignment,
  LyricLine,
  LyricsAlignment,
  LyricsAlignmentMethod,
  PitchTrack,
} from "../utils/validators.js";

/**
 * Constantes do alinhamento pelas pausas da voz (sdd-007). Tudo em ms sobre a grade de 10 ms
 * do `PitchTrack`. Algoritmo e critérios em `specs/sdd-007-lyrics-alignment/tasks.md` §3.
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

/**
 * Aceite do alinhamento forçado devolvido pelo worker (sdd-010). Calibrado na etapa 0 com
 * Pitty "Na Sua Estante", Marília "Infiel" e Tiago Iorc "Tempo Perdido"
 * (`apps/worker/README.md`, "Alinhamento da letra").
 */
export const FORCED_CONFIG = {
  /** Linha cuja média das probabilidades dos caracteres fica abaixo disto é recusada. */
  minLineScore: 0.4,
  /** Abaixo desta fração de linhas com texto aceitas, o alinhamento é recusado (`aligned: false`). */
  minMatchedRatio: 0.5,
  /** Distância mínima entre duas linhas consecutivas depois do alinhamento. */
  minLineGapMs: 200,
  /** Linha "cantada" por mais que isto absorveu áudio que não é dela (refrão a mais, solo). */
  maxLineDurationMs: 20_000,
} as const;

export interface AlignmentResult extends LyricsAlignment {
  method: LyricsAlignmentMethod;
  /** Letra alinhada, ou `null` quando `aligned` é `false`. */
  lines: LyricLine[] | null;
}

function notAligned(method: LyricsAlignmentMethod): AlignmentResult {
  return { aligned: false, shiftMs: 0, matchedRatio: 0, method, lines: null };
}

/**
 * Alinha a letra sincronizada (cronometrada em cima de outra gravação) ao áudio da referência.
 *
 * Função pura e determinística: mesma letra + mesma referência (+ mesmo alinhamento do
 * worker) → mesmo resultado. Só desloca as linhas — **nunca muda a velocidade da letra**
 * (sem escala de andamento, decisão do usuário em `specs/sdd-007-lyrics-alignment/tasks.md`
 * §2). Dois caminhos:
 *
 * - **`forced`** (sdd-010): o worker alinhou o texto de cada linha sobre a voz isolada
 *   (CTC, `apps/worker/app/alignment.py`). Cada linha com texto é aceita ou recusada pela
 *   confiança (`score ≥ 0,4`) e pela duração (≤ 20 s); as aceitas vão para onde são
 *   cantadas de fato, as recusadas e as instrumentais recebem o deslocamento da vizinha
 *   aceita. `shiftMs` é a mediana de (alinhado − original), só para diagnóstico.
 * - **`onset`** (sdd-007, fallback quando o worker não devolve alinhamento): inícios de
 *   frase da referência (`voicedSegments` + silêncio ≥ 350 ms), deslocamento global por
 *   varredura em ±12 s e encaixe de cada linha no início de frase livre a até 350 ms.
 *
 * Nos dois, menos da metade das linhas com texto aceitas/encaixadas → `aligned: false` e
 * `lines: null`: um deslocamento errado é pior que nenhum, então o consumidor volta para a
 * letra original.
 */
export const alignmentService = {
  align(lines: LyricLine[], reference: PitchTrack, forced?: ForcedAlignment | null): AlignmentResult {
    // Tamanho diferente é bug entre API e worker: degrada para o método por pausas.
    if (forced && forced.lines.length === lines.length) return alignForced(lines, reference, forced);
    return alignByOnsets(lines, reference);
  },
};

// ─── Caminho forçado (sdd-010) ───────────────────────────────────────────────

function alignForced(lines: LyricLine[], reference: PitchTrack, forced: ForcedAlignment): AlignmentResult {
  const { minLineScore, minMatchedRatio, minLineGapMs, maxLineDurationMs } = FORCED_CONFIG;

  const textCount = lines.filter((line) => hasText(line)).length;
  if (textCount === 0) return notAligned("forced");

  // Instante aceito por linha (`null` = recusada, instrumental ou não alinhada).
  const accepted: (number | null)[] = lines.map((line, index) => {
    const result = forced.lines[index];
    if (!hasText(line) || result === undefined) return null;
    if (result.startMs === null || result.endMs === null || result.score === null) return null;
    if (result.score < minLineScore || result.endMs - result.startMs > maxLineDurationMs) return null;
    return result.startMs;
  });

  const deltas: number[] = [];
  accepted.forEach((startMs, index) => {
    if (startMs !== null) deltas.push(startMs - (lines[index]?.startMs ?? 0));
  });

  const matchedRatio = round3(deltas.length / textCount);
  const shiftMs = deltas.length > 0 ? Math.round(median(deltas)) : 0;
  if (matchedRatio < minMatchedRatio) return { aligned: false, shiftMs, matchedRatio, method: "forced", lines: null };

  // Próxima linha aceita a partir de cada índice (para as recusadas do começo e para não
  // empurrar uma aceita com as recusadas que vêm antes dela).
  const nextAccepted: (number | null)[] = new Array<number | null>(lines.length).fill(null);
  for (let i = lines.length - 1, next: number | null = null; i >= 0; i--) {
    nextAccepted[i] = next;
    if (accepted[i] !== null) next = i;
  }

  const aligned: LyricLine[] = [];
  let previousAccepted: number | null = null;
  let previous: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const own = accepted[i] ?? null;
    let startMs: number;

    if (own !== null) {
      startMs = own;
      previousAccepted = i;
    } else {
      // Deslocamento da vizinha aceita anterior (ou da próxima, no começo da música), sem
      // sair do intervalo entre as duas aceitas vizinhas.
      const neighbor = previousAccepted ?? nextAccepted[i] ?? null;
      const neighborStart = neighbor === null ? null : (accepted[neighbor] ?? null);
      const neighborLine = neighbor === null ? undefined : lines[neighbor];
      const delta = neighborStart === null || neighborLine === undefined ? shiftMs : neighborStart - neighborLine.startMs;
      startMs = line.startMs + delta;

      const before = previousAccepted === null ? null : (accepted[previousAccepted] ?? null);
      if (before !== null && previousAccepted !== null) {
        startMs = Math.max(startMs, before + minLineGapMs * (i - previousAccepted));
      }
      const afterIndex = nextAccepted[i] ?? null;
      const after = afterIndex === null ? null : (accepted[afterIndex] ?? null);
      if (after !== null && afterIndex !== null) {
        startMs = Math.min(startMs, after - minLineGapMs * (afterIndex - i));
      }
    }

    if (previous !== null) startMs = Math.max(startMs, previous + minLineGapMs);
    startMs = Math.min(reference.durationMs, Math.max(0, startMs));
    previous = startMs;

    aligned.push({ startMs, text: line.text });
  }

  return { aligned: true, shiftMs, matchedRatio, method: "forced", lines: aligned };
}

// ─── Caminho pelas pausas da voz (sdd-007) ───────────────────────────────────

function alignByOnsets(lines: LyricLine[], reference: PitchTrack): AlignmentResult {
  const { segment, shift, snap } = ALIGNMENT_CONFIG;

  const onsets = phraseOnsets(reference, segment.mergeGapMs, segment.minSegmentMs, segment.minSilenceBeforeOnsetMs);
  const textLines = lines.filter((line) => hasText(line));
  if (textLines.length < shift.minLines || onsets.length < shift.minLines) return notAligned("onset");

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

  return { aligned: isAligned, shiftMs, matchedRatio, method: "onset", lines: isAligned ? aligned : null };
}

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
