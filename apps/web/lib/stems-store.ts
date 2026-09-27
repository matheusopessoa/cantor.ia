/**
 * Cache das trilhas separadas (voz e instrumental) no IndexedDB, por `songId`. Dois tipos de
 * registro, pela origem das trilhas:
 * - `stemsKey` (sdd-016): baixadas de `GET /:id/stems/*`; valem enquanto a música tiver a
 *   mesma chave (referência refeita → chave nova → baixa de novo).
 * - `sourceSize` (sdd-013): separadas pelo worker a partir do áudio que o browser tinha; valem
 *   enquanto o áudio for o mesmo (o arquivo da música foi trocado → separa de novo).
 * Tudo em try/catch, como o `audio-store.ts`.
 */

import { STEMS_STORE, getValue, putValue } from "./indexed-db";

export interface SongStems {
  vocals: Blob;
  instrumental: Blob;
  /** Tamanho do áudio de onde as trilhas saíram (fallback da sdd-013). */
  sourceSize?: number;
  /** Chave das trilhas do servidor (sdd-016). */
  stemsKey?: string;
}

function isSongStems(value: unknown): value is SongStems {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!(record.vocals instanceof Blob) || !(record.instrumental instanceof Blob)) return false;
  return typeof record.sourceSize === "number" || typeof record.stemsKey === "string";
}

/** As trilhas em cache são as do servidor para esta `stemsKey`? Registro do fallback não conta. */
export function storedStemsValid(cached: SongStems | null, stemsKey: string): boolean {
  return cached !== null && cached.stemsKey === stemsKey;
}

/** As trilhas em cache saíram deste áudio (fallback da sdd-013)? Registro do servidor não conta. */
export function separatedStemsValid(cached: SongStems | null, sourceSize: number): boolean {
  return cached !== null && cached.stemsKey === undefined && cached.sourceSize === sourceSize;
}

export async function getSongStems(songId: string): Promise<SongStems | null> {
  try {
    const value = await getValue(STEMS_STORE, songId);
    return isSongStems(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveSongStems(songId: string, stems: SongStems): Promise<void> {
  try {
    await putValue(STEMS_STORE, songId, stems);
  } catch {
    // sem cache: baixa (ou separa) de novo na próxima sessão
  }
}
