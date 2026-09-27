import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { workerClient } from "../../clients/worker.client.js";
import { env } from "../../config/env.js";
import { songRepository } from "../../repositories/song.repository.js";
import { stemsRepository } from "../../repositories/stems.repository.js";
import { prisma } from "../../utils/prisma.js";
import { extraction, melody, multipartFile, seedReadySong, seedSong, STEM_FILES, VIDEO_ID, waitForReferenceStatus } from "../helpers/songs.js";
import { makeTrack } from "../helpers/tracks.js";
import { SONG_MS } from "../helpers/songs.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), fetchYoutubeAudio: vi.fn(), separateStems: vi.fn() },
  };
});

const URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

function fromYoutube(id: string, extra: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: `/api/songs/${id}/reference/youtube`, payload: { url: URL, ...extra } });
}

function getStem(id: string, stem: string) {
  return app.inject({ method: "GET", url: `/api/songs/${id}/stems/${stem}` });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  vi.mocked(workerClient.extractFromYoutube).mockReset();
  vi.mocked(workerClient.extract).mockReset();
  await rm(env.SONG_STEMS_DIR, { recursive: true, force: true });
});

/** Trilhas guardadas na preparação (sdd-016): a API pede `stems` ao worker e grava na pasta local. */
describe("referência com trilhas (sdd-016)", () => {
  it("worker devolve as trilhas → arquivos na pasta e stemsKey gravada junto com o READY", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, null, null, null, STEM_FILES));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.stemsKey).toMatch(/^[0-9a-f-]{36}$/);
    const dir = join(env.SONG_STEMS_DIR, song.id, stored.stemsKey!);
    expect(await readFile(join(dir, "vocals.m4a"))).toEqual(STEM_FILES.vocals);
    expect(await readFile(join(dir, "instrumental.m4a"))).toEqual(STEM_FILES.instrumental);
    expect(workerClient.extractFromYoutube).toHaveBeenCalledWith(VIDEO_ID, expect.anything(), { stems: true });
  });

  it("upload da referência também pede e guarda as trilhas (música de arquivo toca pelas trilhas)", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.extract).mockResolvedValue(extraction(melody.track, null, null, null, STEM_FILES));

    const response = await app.inject({ method: "POST", url: `/api/songs/${song.id}/reference`, ...multipartFile(Buffer.from("x")) });

    expect(response.statusCode).toBe(202);
    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.stemsKey).not.toBeNull();
    expect(workerClient.extract).toHaveBeenCalledWith(Buffer.from("x"), "musica.mp3", expect.anything(), { stems: true });
    const vocals = await getStem(song.id, "vocals");
    expect(vocals.statusCode).toBe(200);
  });

  it("worker sem trilhas (stems null) → READY com stemsKey nula e nada na pasta", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.stemsKey).toBeNull();
    expect(await exists(join(env.SONG_STEMS_DIR, song.id))).toBe(false);
  });

  it("gravar as trilhas falha (caminho da música não é pasta) → READY sem stemsKey, nunca FAILED", async () => {
    const song = await seedSong();
    await mkdir(env.SONG_STEMS_DIR, { recursive: true });
    await writeFile(join(env.SONG_STEMS_DIR, song.id), "não sou pasta");
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, null, null, null, STEM_FILES));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.stemsKey).toBeNull();
    expect(stored.referenceTrack).toEqual(melody.track);
    expect((await getStem(song.id, "vocals")).statusCode).toBe(404);
  });

  it("duração divergente → FAILED sem stemsKey e sem arquivos na pasta", async () => {
    const song = await seedSong();
    const shorter = makeTrack(new Array<number | null>((SONG_MS - 20_000) / 10).fill(60));
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(shorter, null, null, null, STEM_FILES));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "FAILED");
    expect(stored.referenceError).toBe("DURATION_MISMATCH");
    expect(stored.stemsKey).toBeNull();
    expect(await exists(join(env.SONG_STEMS_DIR, song.id))).toBe(false);
  });

  it("redo zera a stemsKey no claim, apaga a pasta velha e grava uma chave nova ao terminar", async () => {
    const song = await seedReadySong({ stemsKey: "old-key" });
    await stemsRepository.save(song.id, "old-key", STEM_FILES);
    let finish!: () => void;
    vi.mocked(workerClient.extractFromYoutube).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve(extraction(melody.track, null, null, null, STEM_FILES));
      }),
    );

    const response = await fromYoutube(song.id, { redo: true });

    expect(response.statusCode).toBe(202);
    const claimed = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(claimed.stemsKey).toBeNull();
    expect(await exists(join(env.SONG_STEMS_DIR, song.id, "old-key"))).toBe(false);
    expect((await getStem(song.id, "vocals")).statusCode).toBe(404);

    finish();
    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.stemsKey).not.toBeNull();
    expect(stored.stemsKey).not.toBe("old-key");
    expect(await readdir(join(env.SONG_STEMS_DIR, song.id))).toEqual([stored.stemsKey]);
  });

  it("worker falha → FAILED com stemsKey nula", async () => {
    const song = await seedReadySong({ stemsKey: "old-key" });
    vi.mocked(workerClient.extractFromYoutube).mockRejectedValue(new Error("boom"));

    await fromYoutube(song.id, { redo: true });

    const stored = await waitForReferenceStatus(song.id, "FAILED");
    expect(stored.stemsKey).toBeNull();
  });

  it("failOrphanedProcessing zera a stemsKey", async () => {
    const song = await seedSong({ referenceStatus: "PROCESSING", referenceUpdatedAt: new Date(Date.now() - 60_000), stemsKey: "k" });

    await songRepository.failOrphanedProcessing(new Date(Date.now() + 1_000));

    expect((await prisma.song.findUniqueOrThrow({ where: { id: song.id } })).stemsKey).toBeNull();
  });

  it("findStemsKeys lista só as músicas com chave", async () => {
    const withKey = await seedReadySong({ lrclibId: 1, stemsKey: "k1" });
    await seedReadySong({ lrclibId: 2 });

    expect(await songRepository.findStemsKeys()).toEqual([{ id: withKey.id, stemsKey: "k1" }]);
  });

  it("o SongDto expõe a stemsKey (nula sem trilhas)", async () => {
    const withKey = await seedReadySong({ lrclibId: 1, stemsKey: "k1" });
    const without = await seedReadySong({ lrclibId: 2 });

    expect((await app.inject({ method: "GET", url: `/api/songs/${withKey.id}` })).json().stemsKey).toBe("k1");
    expect((await app.inject({ method: "GET", url: `/api/songs/${without.id}` })).json().stemsKey).toBeNull();
  });
});

describe("GET /api/songs/:id/stems/:stem (sdd-016)", () => {
  it("devolve cada trilha como audio/mp4 com content-length, em streaming do disco", async () => {
    const song = await seedReadySong({ stemsKey: "k1" });
    await stemsRepository.save(song.id, "k1", STEM_FILES);

    const vocals = await getStem(song.id, "vocals");
    const instrumental = await getStem(song.id, "instrumental");

    expect(vocals.statusCode).toBe(200);
    expect(vocals.headers["content-type"]).toBe("audio/mp4");
    expect(vocals.headers["content-length"]).toBe(String(STEM_FILES.vocals.length));
    expect(Buffer.from(vocals.rawPayload).equals(STEM_FILES.vocals)).toBe(true);
    expect(instrumental.statusCode).toBe(200);
    expect(Buffer.from(instrumental.rawPayload).equals(STEM_FILES.instrumental)).toBe(true);
  });

  it("trilha fora do enum → 400 (o nome nunca vira caminho)", async () => {
    const song = await seedReadySong({ stemsKey: "k1" });
    await stemsRepository.save(song.id, "k1", STEM_FILES);

    expect((await getStem(song.id, "..%2Fk1%2Fvocals")).statusCode).toBe(400);
    expect((await getStem(song.id, "drums")).statusCode).toBe(400);
  });

  it("id inválido → 400; música inexistente → 404", async () => {
    expect((await getStem("nao-uuid", "vocals")).statusCode).toBe(400);
    expect((await getStem("019a0000-0000-7000-8000-000000000000", "vocals")).statusCode).toBe(404);
  });

  it("sem stemsKey (música anterior à sdd-016) → 404 STEMS_NOT_STORED", async () => {
    const song = await seedReadySong();

    const response = await getStem(song.id, "vocals");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: expect.any(String), code: "STEMS_NOT_STORED" });
  });

  it("READY não é o status → 404 STEMS_NOT_STORED mesmo com chave", async () => {
    const song = await seedSong({ referenceStatus: "PROCESSING", referenceUpdatedAt: new Date(), stemsKey: "k1" });
    await stemsRepository.save(song.id, "k1", STEM_FILES);

    expect((await getStem(song.id, "vocals")).json()).toMatchObject({ code: "STEMS_NOT_STORED" });
  });

  it("arquivo apagado à mão → 404 STEMS_NOT_STORED", async () => {
    const song = await seedReadySong({ stemsKey: "k1" });
    await stemsRepository.save(song.id, "k1", STEM_FILES);
    await rm(join(env.SONG_STEMS_DIR, song.id, "k1", "vocals.m4a"));

    expect((await getStem(song.id, "vocals")).json()).toMatchObject({ code: "STEMS_NOT_STORED" });
    expect((await getStem(song.id, "instrumental")).statusCode).toBe(200);
  });
});
