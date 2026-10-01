/**
 * O banco IndexedDB do app (`cantor-ia`), compartilhado pelos caches de áudio: `song-audio`
 * (a música, `audio-store.ts`) e `song-stems` (voz e instrumental separados, sdd-013,
 * `stems-store.ts`). A versão sobe a cada store novo; o `onupgradeneeded` cria os que faltam.
 * Quem abre trata a falha: sem IndexedDB (aba anônima, storage bloqueado) o app segue sem cache.
 */

const DB_NAME = "cantor-ia";
const DB_VERSION = 2;

export const AUDIO_STORE = "song-audio";
export const STEMS_STORE = "song-stems";

const STORES = [AUDIO_STORE, STEMS_STORE];

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir o IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB bloqueado"));
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha no IndexedDB"));
  });
}

/** Grava `value` em `key` no `store`, numa transação própria. Rejeita se a gravação falhar. */
export async function putValue(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao gravar no IndexedDB"));
      tx.onabort = () => reject(tx.error ?? new Error("Gravação abortada"));
    });
  } finally {
    db.close();
  }
}

/** Lê `key` do `store`; `undefined` quando não existe. */
export async function getValue(store: string, key: string): Promise<unknown> {
  const db = await openDb();
  try {
    return await requestToPromise(db.transaction(store, "readonly").objectStore(store).get(key));
  } finally {
    db.close();
  }
}
