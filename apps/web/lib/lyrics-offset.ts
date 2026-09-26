/**
 * Mesmos limites de `performanceBodySchema.offsetMs` (`LYRICS_OFFSET_LIMIT_MS` na API): ±10 s,
 * em passos de 100 ms. O ajuste só desloca a letra, nunca muda a velocidade dela: se a letra
 * acabar antes ou depois da música, é esperado e não é erro.
 */
export const OFFSET_MIN_MS = -10_000;
export const OFFSET_MAX_MS = 10_000;
export const OFFSET_STEP_MS = 100;

/** Arredonda ao passo e limita à faixa aceita pela API. NaN vira 0. */
export function normalizeOffsetMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const stepped = Math.round(value / OFFSET_STEP_MS) * OFFSET_STEP_MS;
  return Math.min(OFFSET_MAX_MS, Math.max(OFFSET_MIN_MS, stepped));
}

function storageKey(songId: string): string {
  return `cantor.ia:offset:${songId}`;
}

/** Ajuste memorizado para esta música neste dispositivo (regra 6). */
export function loadOffsetMs(songId: string): number {
  try {
    const raw = window.localStorage.getItem(storageKey(songId));
    return raw === null ? 0 : normalizeOffsetMs(Number(raw));
  } catch {
    return 0;
  }
}

export function saveOffsetMs(songId: string, offsetMs: number): void {
  try {
    window.localStorage.setItem(storageKey(songId), String(normalizeOffsetMs(offsetMs)));
  } catch {
    // sem storage: o ajuste vale só nesta sessão
  }
}
