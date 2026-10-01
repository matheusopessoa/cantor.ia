import { useCallback, useState, useSyncExternalStore } from "react";
import { DEFAULT_DIFFICULTY, isDifficulty, loadDifficulty, saveDifficulty } from "./difficulty";
import { loadOffsetMs, normalizeOffsetMs, saveOffsetMs } from "./lyrics-offset";
import { DEFAULT_MONITOR_VOLUME, loadMonitorVolume, normalizeMonitorVolume, saveMonitorVolume } from "./monitor-volume";
import { NO_SECOND_OUTPUT, loadSecondOutput, saveSecondOutput } from "./music-output";
import { loadPlayerName, savePlayerName } from "./player-name";
import { DEFAULT_SINGER_VOLUME, loadSingerVolume, normalizeSingerVolume, saveSingerVolume } from "./singer-volume";
import type { Difficulty } from "./types";

/**
 * Preferências guardadas no dispositivo (nome do jogador, ajuste da letra, nível, retorno do
 * microfone, segunda saída da música, voz do cantor) lidas com
 * `useSyncExternalStore`: o servidor renderiza o valor vazio e o browser troca pelo
 * guardado depois da hidratação, sem `setState` dentro de efeito. A memória é a fonte
 * primária, então tudo funciona mesmo sem `localStorage` (aba anônima).
 */

const listeners = new Set<() => void>();
const memory = new Map<string, string | number>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

const NAME_KEY = "player-name";

function readPlayerName(): string {
  const cached = memory.get(NAME_KEY);
  return typeof cached === "string" ? cached : (loadPlayerName() ?? "");
}

/** Nome guardado + rascunho em edição. `commit` grava o nome (chamado ao ir cantar). */
export function usePlayerName(): { name: string; setName: (value: string) => void; commit: (value: string) => void } {
  const stored = useSyncExternalStore(subscribe, readPlayerName, () => "");
  const [draft, setDraft] = useState<string | null>(null);

  const commit = useCallback((value: string) => {
    savePlayerName(value);
    memory.set(NAME_KEY, value.trim());
    setDraft(null);
    notify();
  }, []);

  return { name: draft ?? stored, setName: setDraft, commit };
}

function offsetKey(songId: string, aligned: boolean): string {
  return `offset:${songId}:${aligned ? "aligned" : "original"}`;
}

/**
 * Ajuste da letra desta música, já persistido a cada mudança. `aligned` diz qual letra está
 * na tela: o ajuste da original não vale para a alinhada (ver `offsetStorageKey`).
 */
export function useLyricsOffset(songId: string, aligned: boolean): [number, (value: number) => void] {
  const read = useCallback(() => {
    const cached = memory.get(offsetKey(songId, aligned));
    return typeof cached === "number" ? cached : loadOffsetMs(songId, aligned);
  }, [songId, aligned]);
  const value = useSyncExternalStore(subscribe, read, () => 0);

  const set = useCallback(
    (next: number) => {
      const normalized = normalizeOffsetMs(next);
      memory.set(offsetKey(songId, aligned), normalized);
      saveOffsetMs(songId, aligned, normalized);
      notify();
    },
    [songId, aligned],
  );

  return [value, set];
}

const DIFFICULTY_KEY = "difficulty";

function readDifficulty(): Difficulty {
  const cached = memory.get(DIFFICULTY_KEY);
  return isDifficulty(cached) ? cached : loadDifficulty();
}

/** Nível escolhido (sdd-009), memorizado a cada mudança. Padrão `MEDIUM` para quem nunca escolheu. */
export function useDifficulty(): [Difficulty, (value: Difficulty) => void] {
  const value = useSyncExternalStore(subscribe, readDifficulty, () => DEFAULT_DIFFICULTY);

  const set = useCallback((next: Difficulty) => {
    memory.set(DIFFICULTY_KEY, next);
    saveDifficulty(next);
    notify();
  }, []);

  return [value, set];
}

const MONITOR_KEY = "monitor-volume";

function readMonitorVolume(): number {
  const cached = memory.get(MONITOR_KEY);
  return typeof cached === "number" ? cached : loadMonitorVolume();
}

/** Volume do retorno do microfone no fone (0–100), memorizado a cada mudança. */
export function useMonitorVolume(): [number, (value: number) => void] {
  const value = useSyncExternalStore(subscribe, readMonitorVolume, () => DEFAULT_MONITOR_VOLUME);

  const set = useCallback((next: number) => {
    const normalized = normalizeMonitorVolume(next);
    memory.set(MONITOR_KEY, normalized);
    saveMonitorVolume(normalized);
    notify();
  }, []);

  return [value, set];
}

const SECOND_OUTPUT_KEY = "second-output";

function readSecondOutput(): string {
  const cached = memory.get(SECOND_OUTPUT_KEY);
  return typeof cached === "string" ? cached : loadSecondOutput();
}

/** Aparelho onde a música também toca (`NO_SECOND_OUTPUT` = só a saída padrão), memorizado. */
export function useSecondOutput(): [string, (deviceId: string) => void] {
  const value = useSyncExternalStore(subscribe, readSecondOutput, () => NO_SECOND_OUTPUT);

  const set = useCallback((next: string) => {
    memory.set(SECOND_OUTPUT_KEY, next);
    saveSecondOutput(next);
    notify();
  }, []);

  return [value, set];
}

const SINGER_KEY = "singer-volume";

function readSingerVolume(): number {
  const cached = memory.get(SINGER_KEY);
  return typeof cached === "number" ? cached : loadSingerVolume();
}

/** Volume da voz do cantor original (0–100, sdd-013), memorizado a cada mudança. Padrão 50. */
export function useSingerVolume(): [number, (value: number) => void] {
  const value = useSyncExternalStore(subscribe, readSingerVolume, () => DEFAULT_SINGER_VOLUME);

  const set = useCallback((next: number) => {
    const normalized = normalizeSingerVolume(next);
    memory.set(SINGER_KEY, normalized);
    saveSingerVolume(normalized);
    notify();
  }, []);

  return [value, set];
}
