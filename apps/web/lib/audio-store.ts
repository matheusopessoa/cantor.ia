/**
 * Cache do áudio da música no browser (IndexedDB), por `songId`. O servidor não guarda
 * áudio: depois do primeiro download, a música toca daqui. Tudo em try/catch: sem
 * IndexedDB (aba anônima, storage bloqueado) o app segue sem cache. O banco e a abertura
 * ficam em `indexed-db.ts` (compartilhados com as trilhas separadas, sdd-013).
 */

import { AUDIO_STORE, getValue, putValue } from "./indexed-db";

export async function getSongAudio(songId: string): Promise<Blob | null> {
  try {
    const value = await getValue(AUDIO_STORE, songId);
    return value instanceof Blob ? value : null;
  } catch {
    return null;
  }
}

export async function saveSongAudio(songId: string, file: Blob): Promise<void> {
  try {
    await putValue(AUDIO_STORE, songId, file);
  } catch {
    // sem cache: baixa de novo na próxima sessão
  }
}
