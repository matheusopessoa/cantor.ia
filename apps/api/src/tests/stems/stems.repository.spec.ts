import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../../config/env.js";
import { stemsRepository } from "../../repositories/stems.repository.js";

const SONG_A = "019a0000-0000-7000-8000-00000000000a";
const SONG_B = "019a0000-0000-7000-8000-00000000000b";
const FILES = { vocals: Buffer.from("VOZ"), instrumental: Buffer.from("INSTRUMENTAL") };

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  return text;
}

beforeEach(async () => {
  await rm(env.SONG_STEMS_DIR, { recursive: true, force: true });
});

/** A pasta local de trilhas (sdd-016): `SONG_STEMS_DIR/<songId>/<stemsKey>/{vocals,instrumental}.m4a`. */
describe("stemsRepository", () => {
  it("SONG_STEMS_DIR da suíte é absoluto e termina em .data/stems-test (nunca a pasta de dev)", () => {
    expect(env.SONG_STEMS_DIR).toMatch(/^\//);
    expect(env.SONG_STEMS_DIR.replace(/\\/g, "/")).toMatch(/\/\.data\/stems-test$/);
  });

  it("save grava as duas trilhas na pasta da chave e open devolve stream, tamanho e audio/mp4", async () => {
    await stemsRepository.save(SONG_A, "k1", FILES);

    expect(await readdir(join(env.SONG_STEMS_DIR, SONG_A, "k1"))).toEqual(["instrumental.m4a", "vocals.m4a"]);
    const vocals = await stemsRepository.open(SONG_A, "k1", "vocals");
    const instrumental = await stemsRepository.open(SONG_A, "k1", "instrumental");
    expect(vocals).toMatchObject({ size: 3, contentType: "audio/mp4" });
    expect(await readAll(vocals!.stream)).toBe("VOZ");
    expect(instrumental).toMatchObject({ size: 12, contentType: "audio/mp4" });
    expect(await readAll(instrumental!.stream)).toBe("INSTRUMENTAL");
  });

  it("save não deixa .part para trás e sobrescreve a mesma chave", async () => {
    await stemsRepository.save(SONG_A, "k1", FILES);
    await stemsRepository.save(SONG_A, "k1", { vocals: Buffer.from("V2"), instrumental: Buffer.from("I2") });

    expect(await readdir(join(env.SONG_STEMS_DIR, SONG_A, "k1"))).toEqual(["instrumental.m4a", "vocals.m4a"]);
    expect(await readFile(join(env.SONG_STEMS_DIR, SONG_A, "k1", "vocals.m4a"), "utf8")).toBe("V2");
  });

  it("save lança quando o caminho da música não é uma pasta (disco recusou)", async () => {
    await mkdir(env.SONG_STEMS_DIR, { recursive: true });
    await writeFile(join(env.SONG_STEMS_DIR, SONG_A), "não sou pasta");

    await expect(stemsRepository.save(SONG_A, "k1", FILES)).rejects.toThrow();
  });

  it("open devolve null para chave, música ou arquivo inexistente", async () => {
    await stemsRepository.save(SONG_A, "k1", FILES);
    await rm(join(env.SONG_STEMS_DIR, SONG_A, "k1", "vocals.m4a"));

    expect(await stemsRepository.open(SONG_A, "k1", "vocals")).toBeNull();
    expect(await stemsRepository.open(SONG_A, "k1", "instrumental")).not.toBeNull();
    expect(await stemsRepository.open(SONG_A, "k2", "vocals")).toBeNull();
    expect(await stemsRepository.open(SONG_B, "k1", "vocals")).toBeNull();
  });

  it("prune(keep) apaga as outras chaves da música e mantém a atual", async () => {
    await stemsRepository.save(SONG_A, "old", FILES);
    await stemsRepository.save(SONG_A, "new", FILES);
    await stemsRepository.save(SONG_B, "k", FILES);

    expect(await stemsRepository.prune(SONG_A, "new")).toBe(1);

    expect(await readdir(join(env.SONG_STEMS_DIR, SONG_A))).toEqual(["new"]);
    expect(await exists(join(env.SONG_STEMS_DIR, SONG_B, "k"))).toBe(true);
  });

  it("prune(null) apaga a pasta inteira da música; sem pasta, devolve 0 sem lançar", async () => {
    await stemsRepository.save(SONG_A, "k1", FILES);
    await stemsRepository.save(SONG_A, "k2", FILES);

    expect(await stemsRepository.prune(SONG_A, null)).toBe(2);
    expect(await exists(join(env.SONG_STEMS_DIR, SONG_A))).toBe(false);
    expect(await stemsRepository.prune(SONG_A, null)).toBe(0);
    expect(await stemsRepository.prune(SONG_B, "x")).toBe(0);
  });

  it("sweep apaga músicas fora da lista e chaves que não são a atual, mantendo o resto", async () => {
    await stemsRepository.save(SONG_A, "current", FILES);
    await stemsRepository.save(SONG_A, "stale", FILES);
    await stemsRepository.save(SONG_B, "gone", FILES);

    const removed = await stemsRepository.sweep(new Map([[SONG_A, "current"]]));

    expect(removed).toBe(2);
    expect(await readdir(env.SONG_STEMS_DIR)).toEqual([SONG_A]);
    expect(await readdir(join(env.SONG_STEMS_DIR, SONG_A))).toEqual(["current"]);
  });

  it("sweep sem a pasta raiz (primeiro boot) devolve 0", async () => {
    expect(await stemsRepository.sweep(new Map())).toBe(0);
    expect(await exists(env.SONG_STEMS_DIR)).toBe(false);
  });
});
