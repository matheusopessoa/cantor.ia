/**
 * Helpers matemáticos puros para curvas de pitch (`PitchTrack.midi`: uma nota MIDI
 * fracionária a cada frame, ou `null` quando não há voz).
 *
 * Sem estado de negócio: as regras da nota vivem em `services/scoring.service.ts` e as do
 * alinhamento da letra em `services/alignment.service.ts`.
 */

/**
 * Reduz uma diferença em semitons para o intervalo [-6, 6).
 *
 * É o que faz uma oitava acima ou abaixo valer o mesmo que a nota original:
 * `fold12(12) === 0`, `fold12(-12) === 0`, `fold12(13.5) === 1.5`.
 */
export function fold12(semitones: number): number {
  const positive = ((semitones % 12) + 12) % 12; // [0, 12)
  return positive >= 6 ? positive - 12 : positive;
}

/**
 * Mediana dos valores. Não altera o array recebido.
 * Lista vazia devolve 0 (sem dados, sem deslocamento).
 */
export function median(values: readonly number[]): number {
  const count = values.length;
  if (count === 0) return 0;

  // Typed array: ordenação numérica nativa, bem mais rápida que sort() com comparador
  // para as dezenas de milhares de frames de uma música.
  const sorted = Float64Array.from(values).sort();
  const middle = count >> 1;
  const upper = sorted[middle] ?? 0;

  if (count % 2 === 1) return upper;

  const lower = sorted[middle - 1] ?? 0;
  return (lower + upper) / 2;
}

/**
 * Procura um *início* de voz (onset) em `[fromFrame, toFrame]`.
 *
 * Um onset é um frame com voz precedido por silêncio (ou o frame 0) que abre um trecho
 * contínuo de pelo menos `minRun` frames com voz. O trecho pode continuar além de
 * `toFrame`; só o início precisa estar na janela. Voz que já estava soando antes de
 * `fromFrame` não é um onset dentro da janela.
 *
 * Sem `nearFrame`, devolve o primeiro onset da janela. Com `nearFrame`, devolve o onset
 * mais próximo dele (empate: o anterior). É o que a nota usa: o fim da linha anterior costuma
 * chegar à janela com falhas curtas de detecção, e cada "reinício" desses seria tomado como a
 * entrada da linha se valesse o primeiro.
 *
 * Devolve o índice do frame de início, ou `null` se não houver onset na janela.
 */
export function findOnset(
  track: readonly (number | null)[],
  fromFrame: number,
  toFrame: number,
  minRun: number,
  nearFrame?: number,
): number | null {
  const run = Math.max(1, Math.floor(minRun));
  const first = Math.max(0, Math.floor(fromFrame));
  const last = Math.min(track.length - 1, Math.floor(toFrame));
  if (last < first) return null;

  let best: number | null = null;

  for (let start = first; start <= last; start++) {
    if (nearFrame !== undefined && best !== null && start - nearFrame >= Math.abs(best - nearFrame)) {
      break; // daqui em diante só fica mais longe do alvo
    }
    if (track[start] == null) continue;
    if (start > 0 && track[start - 1] != null) continue; // voz já vinha de antes

    if (start + run > track.length) break;

    let voiced = true;
    for (let k = 1; k < run; k++) {
      if (track[start + k] == null) {
        voiced = false;
        break;
      }
    }
    if (!voiced) continue;

    if (nearFrame === undefined) return start;
    if (best === null || Math.abs(start - nearFrame) < Math.abs(best - nearFrame)) best = start;
  }

  return best;
}

export interface VoicedSegment {
  /** Início do trecho com voz, em ms (inclusivo). */
  startMs: number;
  /** Fim do trecho, em ms (exclusivo: primeiro frame sem voz). */
  endMs: number;
}

/**
 * Trechos contínuos com voz de uma curva de pitch, em ms.
 *
 * - Frames `!= null` consecutivos formam um trecho.
 * - Buracos (frames sem voz) de até `mergeGapMs` entre dois trechos são unidos: uma
 *   consoante ou respiração curta não quebra a frase.
 * - Trechos com menos de `minSegmentMs` (depois de unir) são descartados como ruído.
 *
 * Devolve em ordem crescente. Usado pelo `alignment.service.ts` para achar os inícios de
 * frase da referência.
 */
export function voicedSegments(
  track: readonly (number | null)[],
  hopMs: number,
  mergeGapMs: number,
  minSegmentMs: number,
): VoicedSegment[] {
  const raw: VoicedSegment[] = [];
  let start: number | null = null;

  for (let i = 0; i <= track.length; i++) {
    const voiced = i < track.length && track[i] != null;
    if (voiced && start === null) {
      start = i;
    } else if (!voiced && start !== null) {
      raw.push({ startMs: start * hopMs, endMs: i * hopMs });
      start = null;
    }
  }

  const merged: VoicedSegment[] = [];
  for (const segment of raw) {
    const last = merged[merged.length - 1];
    if (last !== undefined && segment.startMs - last.endMs <= mergeGapMs) {
      last.endMs = segment.endMs;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged.filter((segment) => segment.endMs - segment.startMs >= minSegmentMs);
}
