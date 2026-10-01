/**
 * Volume da voz do cantor original durante o karaokê (sdd-013): de 0 (só o instrumental) a
 * 100 % (a música como veio), em passos de 5. Só vale quando as trilhas separadas (voz e
 * instrumental) existem; sem elas, a música toca como o original.
 */
export const SINGER_MIN = 0;
export const SINGER_MAX = 100;
export const SINGER_STEP = 5;
/** Padrão para quem nunca mexeu: a voz do cantor pela metade ("baixar um pouco"). */
export const DEFAULT_SINGER_VOLUME = 50;

/** As trilhas decodificadas precisam ter a duração do original, senão a sessão toca o original (regra 7). */
export const STEMS_DURATION_TOLERANCE_MS = 100;

/** Arredonda ao passo e limita à faixa. NaN vira o padrão. */
export function normalizeSingerVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SINGER_VOLUME;
  const stepped = Math.round(value / SINGER_STEP) * SINGER_STEP;
  return Math.min(SINGER_MAX, Math.max(SINGER_MIN, stepped));
}

/** Volume (0–100) → ganho do `GainNode` da voz (0–1). 100 % é a música original. */
export function singerGain(volume: number): number {
  return normalizeSingerVolume(volume) / SINGER_MAX;
}

/** As duas trilhas têm a duração do original (±100 ms)? Fora disso, a sessão descarta as trilhas. */
export function stemsMatchOriginal(vocalsMs: number, instrumentalMs: number, originalMs: number): boolean {
  return (
    Math.abs(vocalsMs - originalMs) <= STEMS_DURATION_TOLERANCE_MS &&
    Math.abs(instrumentalMs - originalMs) <= STEMS_DURATION_TOLERANCE_MS
  );
}

const STORAGE_KEY = "cantor.ia:singer-volume";

/** Volume memorizado neste dispositivo; o padrão sem `localStorage` ou sem escolha. */
export function loadSingerVolume(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_SINGER_VOLUME : normalizeSingerVolume(Number(raw));
  } catch {
    return DEFAULT_SINGER_VOLUME;
  }
}

export function saveSingerVolume(volume: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(normalizeSingerVolume(volume)));
  } catch {
    // sem storage: o volume vale só nesta sessão
  }
}
