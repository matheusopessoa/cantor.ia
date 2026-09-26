/**
 * Retorno do microfone no fone: volume da própria voz tocada de volta durante a sessão, de 0
 * (desligado) a 100 %, em passos de 5. Só faz sentido com fone: sem ele, a caixa de som
 * devolve a voz ao microfone e vira microfonia.
 */
export const MONITOR_MIN = 0;
export const MONITOR_MAX = 100;
export const MONITOR_STEP = 5;
/** Padrão para quem nunca mexeu: ligado, abaixo da música. */
export const DEFAULT_MONITOR_VOLUME = 70;

/** Arredonda ao passo e limita à faixa. NaN vira o padrão. */
export function normalizeMonitorVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MONITOR_VOLUME;
  const stepped = Math.round(value / MONITOR_STEP) * MONITOR_STEP;
  return Math.min(MONITOR_MAX, Math.max(MONITOR_MIN, stepped));
}

/** Volume (0–100) → ganho do `GainNode` (0–1). */
export function monitorGain(volume: number): number {
  return normalizeMonitorVolume(volume) / MONITOR_MAX;
}

const STORAGE_KEY = "cantor.ia:monitor-volume";

/** Volume memorizado neste dispositivo; o padrão sem `localStorage` ou sem escolha. */
export function loadMonitorVolume(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_MONITOR_VOLUME : normalizeMonitorVolume(Number(raw));
  } catch {
    return DEFAULT_MONITOR_VOLUME;
  }
}

export function saveMonitorVolume(volume: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(normalizeMonitorVolume(volume)));
  } catch {
    // sem storage: o volume vale só nesta sessão
  }
}
