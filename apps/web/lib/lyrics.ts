import type { LyricLine, SongDto } from "./types";

/** Duração assumida da última linha (mesma constante da nota, sdd-002). */
export const LAST_LINE_DURATION_MS = 5_000;

/**
 * Linhas que a tela, o canvas e a nota usam: a letra alinhada ao áudio pela API quando existe,
 * senão a original (sdd-007). O `offsetMs` do jogador é ajuste fino sobre estas linhas.
 */
export function effectiveLyrics(song: Pick<SongDto, "lyrics" | "alignedLyrics">): LyricLine[] {
  return song.alignedLyrics ?? song.lyrics;
}

/** Instante em que a linha entra, já com o ajuste manual (`startMs - offsetMs`, como na API). */
export function lineStartMs(line: LyricLine, offsetMs: number): number {
  return line.startMs - offsetMs;
}

/**
 * Índice da linha atual em `tMs`: a última cujo início ajustado já passou.
 * Devolve -1 antes da primeira linha. Assume `lines` em ordem crescente de `startMs`.
 */
export function currentLineIndex(lines: readonly LyricLine[], tMs: number, offsetMs = 0): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStartMs(lines[mid], offsetMs) <= tMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found;
}

/**
 * Preenchimento (0..1) da linha `index` em `tMs`: vai do início dela ao início da próxima
 * (ou 5 s, na última). Fora da linha devolve 0 ou 1.
 */
export function lineProgress(lines: readonly LyricLine[], index: number, tMs: number, offsetMs = 0): number {
  if (index < 0 || index >= lines.length) return 0;

  const start = lineStartMs(lines[index], offsetMs);
  const next = index + 1 < lines.length ? lineStartMs(lines[index + 1], offsetMs) : start + LAST_LINE_DURATION_MS;
  const span = Math.max(1, next - start);

  return Math.min(1, Math.max(0, (tMs - start) / span));
}
