/** Tolerância entre o áudio para tocar e a duração da letra (regra 4; igual à API). */
export const DURATION_TOLERANCE_MS = 10_000;

/**
 * Lê a duração de um áudio pelos metadados (sem decodificar tudo e sem gesto do usuário).
 * `null` quando o browser não consegue ler o arquivo.
 */
export function readAudioDurationMs(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "metadata";

    const finish = (value: number | null) => {
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };

    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      finish(Number.isFinite(seconds) ? Math.round(seconds * 1000) : null);
    };
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

export function durationMatches(audioMs: number, songMs: number): boolean {
  return Math.abs(audioMs - songMs) <= DURATION_TOLERANCE_MS;
}
