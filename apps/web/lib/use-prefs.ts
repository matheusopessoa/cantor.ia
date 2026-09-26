import { useCallback, useState, useSyncExternalStore } from "react";
import { loadOffsetMs, normalizeOffsetMs, saveOffsetMs } from "./lyrics-offset";
import { loadPlayerName, savePlayerName } from "./player-name";

/**
 * Preferências guardadas no dispositivo (nome do jogador, ajuste da letra) lidas com
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

function offsetKey(songId: string): string {
  return `offset:${songId}`;
}

/** Ajuste da letra desta música, já persistido a cada mudança. */
export function useLyricsOffset(songId: string): [number, (value: number) => void] {
  const read = useCallback(() => {
    const cached = memory.get(offsetKey(songId));
    return typeof cached === "number" ? cached : loadOffsetMs(songId);
  }, [songId]);
  const value = useSyncExternalStore(subscribe, read, () => 0);

  const set = useCallback(
    (next: number) => {
      const normalized = normalizeOffsetMs(next);
      memory.set(offsetKey(songId), normalized);
      saveOffsetMs(songId, normalized);
      notify();
    },
    [songId],
  );

  return [value, set];
}
