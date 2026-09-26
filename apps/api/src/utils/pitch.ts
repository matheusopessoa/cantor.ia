/**
 * Helpers matemáticos puros para curvas de pitch (`PitchTrack.midi`: uma nota MIDI
 * fracionária a cada frame, ou `null` quando não há voz).
 *
 * Sem estado de negócio: as regras da nota vivem em `services/scoring.service.ts`.
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
 * Procura o primeiro *início* de voz (onset) em `[fromFrame, toFrame]`.
 *
 * Um onset é um frame com voz precedido por silêncio (ou o frame 0) que abre um trecho
 * contínuo de pelo menos `minRun` frames com voz. O trecho pode continuar além de
 * `toFrame`; só o início precisa estar na janela. Voz que já estava soando antes de
 * `fromFrame` não é um onset dentro da janela.
 *
 * Devolve o índice do frame de início, ou `null` se não houver onset na janela.
 */
export function findOnset(
  track: readonly (number | null)[],
  fromFrame: number,
  toFrame: number,
  minRun: number,
): number | null {
  const run = Math.max(1, Math.floor(minRun));
  const first = Math.max(0, Math.floor(fromFrame));
  const last = Math.min(track.length - 1, Math.floor(toFrame));
  if (last < first) return null;

  for (let start = first; start <= last; start++) {
    if (track[start] == null) continue;
    if (start > 0 && track[start - 1] != null) continue; // voz já vinha de antes

    if (start + run > track.length) return null;

    let voiced = true;
    for (let k = 1; k < run; k++) {
      if (track[start + k] == null) {
        voiced = false;
        break;
      }
    }
    if (voiced) return start;
  }

  return null;
}
