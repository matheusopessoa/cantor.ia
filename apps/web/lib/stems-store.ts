/**
 * Cache das trilhas separadas (voz e instrumental, sdd-013) no IndexedDB, por `songId`. O
 * servidor não guarda áudio: o worker separa uma vez por música por aparelho e as trilhas
 * ficam aqui. `sourceSize` é o tamanho do áudio de onde elas saíram: trilha de outro áudio
 * (o arquivo da música foi trocado) é descartada e gerada de novo. Tudo em try/catch, como o
 * `audio-store.ts`.
 */

import { STEMS_STORE, getValue, putValue } from "./indexed-db";

export interface SongStems {
  vocals: Blob;
  instrumental: Blob;
  sourceSize: number;
}

function isSongStems(value: unknown): value is SongStems {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.vocals instanceof Blob && record.instrumental instanceof Blob && typeof record.sourceSize === "number";
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
    // sem cache: separa de novo na próxima sessão
  }
}
