/**
 * Cache do áudio da música no browser (IndexedDB), por `songId`. O servidor não guarda
 * áudio: depois do primeiro download, a música toca daqui. Tudo em try/catch: sem
 * IndexedDB (aba anônima, storage bloqueado) o app segue sem cache.
 */

const DB_NAME = "cantor-ia";
const DB_VERSION = 1;
const STORE = "song-audio";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir o IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB bloqueado"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha no IndexedDB"));
  });
}

export async function getSongAudio(songId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      const value = await requestToPromise(store.get(songId));
      return value instanceof Blob ? value : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function saveSongAudio(songId: string, file: Blob): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(file, songId);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Falha ao gravar no IndexedDB"));
        tx.onabort = () => reject(tx.error ?? new Error("Gravação abortada"));
      });
    } finally {
      db.close();
    }
  } catch {
    // sem cache: baixa de novo na próxima sessão
  }
}
