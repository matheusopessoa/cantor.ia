/** `m:ss` a partir de milissegundos (3:05). Negativos e NaN viram 0:00. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** `mm:ss` para o relógio de espera (01:24). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Nota com uma casa decimal, como a API devolve (8.4). */
export function formatScore(score: number): string {
  return (Math.round(score * 10) / 10).toFixed(1);
}

/** Ajuste da letra em segundos com sinal (+0.5s, -1.2s, +0.0s). */
export function formatOffset(offsetMs: number): string {
  const seconds = offsetMs / 1000;
  return `${seconds >= 0 ? "+" : "-"}${Math.abs(seconds).toFixed(1)}s`;
}

/** Deslocamento do alinhamento da letra em segundos, pt-BR, com sinal (+3,2 s, -0,5 s, +0,0 s). */
export function formatAlignmentShift(shiftMs: number): string {
  const seconds = (Number.isFinite(shiftMs) ? shiftMs : 0) / 1000;
  return `${seconds >= 0 ? "+" : "-"}${Math.abs(seconds).toFixed(1).replace(".", ",")} s`;
}

/** Posição no ranking em inglês de fliperama, só para o HUD: 1st, 2nd, 3rd, 4th, 11th, 21st. */
export function formatOrdinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}
