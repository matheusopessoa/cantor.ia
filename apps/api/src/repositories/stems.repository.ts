import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { env } from "../config/env.js";
import { STEM_NAMES, type StemName } from "../utils/validators.js";

/**
 * A pasta local de trilhas (sdd-016): `<SONG_STEMS_DIR>/<songId>/<stemsKey>/{vocals,instrumental}.m4a`.
 * É acesso a dados, como os repositórios do Prisma, e o único módulo da API que toca o sistema
 * de arquivos. Caminhos são montados só com `songId` (uuid validado) e `stemsKey` (uuid gerado
 * pela API) e com o nome da trilha vindo do enum `STEM_NAMES`: nunca com texto do usuário.
 * Apagar é sempre melhor esforço (nunca lança); gravar e abrir lançam para o service decidir.
 */

/** As duas trilhas em memória, como vêm do worker (~3 MB cada). */
export interface StemFiles {
  vocals: Buffer;
  instrumental: Buffer;
}

/** Uma trilha aberta para leitura em streaming. */
export interface StoredStem {
  stream: Readable;
  size: number;
  contentType: "audio/mp4";
}

function songDir(songId: string): string {
  return join(env.SONG_STEMS_DIR, songId);
}

function keyDir(songId: string, key: string): string {
  return join(songDir(songId), key);
}

function stemFile(songId: string, key: string, stem: StemName): string {
  return join(keyDir(songId, key), `${stem}.m4a`);
}

async function removeQuietly(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export const stemsRepository = {
  /**
   * Grava as duas trilhas em `<songId>/<key>/`, cada uma como `.part` + `rename`: nenhum leitor
   * vê arquivo pela metade. Lança se o disco recusar; quem chama decide o que fazer.
   */
  async save(songId: string, key: string, files: StemFiles): Promise<void> {
    const dir = keyDir(songId, key);
    await mkdir(dir, { recursive: true });
    for (const stem of STEM_NAMES) {
      const final = stemFile(songId, key, stem);
      const part = `${final}.part`;
      await writeFile(part, files[stem]);
      await rename(part, final);
    }
  },

  /** Stream e tamanho de uma trilha; `null` se a pasta ou o arquivo não existe. */
  async open(songId: string, key: string, stem: StemName): Promise<StoredStem | null> {
    const file = stemFile(songId, key, stem);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      return null;
    }
    return { stream: createReadStream(file), size, contentType: "audio/mp4" };
  },

  /**
   * Apaga as chaves da música diferentes de `keep` (nulo = a pasta inteira da música). Melhor
   * esforço: nunca lança. Devolve quantas pastas de chave saíram.
   */
  async prune(songId: string, keep: string | null): Promise<number> {
    if (keep === null) {
      const keys = await listDir(songDir(songId));
      return (await removeQuietly(songDir(songId))) ? keys.length : 0;
    }
    let removed = 0;
    for (const key of await listDir(songDir(songId))) {
      if (key !== keep && (await removeQuietly(keyDir(songId, key)))) removed++;
    }
    return removed;
  },

  /**
   * Boot da API: apaga pastas de músicas que não estão em `current` e chaves que não são a
   * atual (`current` = `songId → stemsKey` das músicas com trilhas). Pasta ausente = nada a
   * fazer. Devolve quantas pastas de chave saíram.
   */
  async sweep(current: Map<string, string>): Promise<number> {
    let removed = 0;
    for (const songId of await listDir(env.SONG_STEMS_DIR)) {
      const keep = current.get(songId);
      removed += await stemsRepository.prune(songId, keep ?? null);
    }
    return removed;
  },
};
