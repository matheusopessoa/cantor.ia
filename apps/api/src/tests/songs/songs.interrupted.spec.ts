import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { workerClient } from "../../clients/worker.client.js";
import { songRepository } from "../../repositories/song.repository.js";
import { prisma } from "../../utils/prisma.js";
import { extraction, melody, seedReadySong, seedSong, VIDEO_ID, waitForReferenceStatus } from "../helpers/songs.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), fetchYoutubeAudio: vi.fn() },
  };
});

/** Uma subida da API depois dos seeds: tudo o que foi semeado em PROCESSING é de antes dela. */
function afterSeed(): Date {
  return new Date(Date.now() + 1_000);
}

beforeEach(() => {
  vi.mocked(workerClient.extractFromYoutube).mockReset();
});

/**
 * Achado da sdd-011: o processamento vive no processo da API. Uma API que reinicia no meio deixa
 * a música em `PROCESSING` para sempre; no boot, `failOrphanedProcessing` marca essas como
 * `FAILED` com `INTERRUPTED`.
 */
describe("songRepository.failOrphanedProcessing", () => {
  it("marca só as em PROCESSING, com INTERRUPTED, e devolve a contagem", async () => {
    const processing = await seedSong({
      lrclibId: 1,
      referenceStatus: "PROCESSING",
      referenceUpdatedAt: new Date(Date.now() - 60_000),
      youtubeVideoId: VIDEO_ID,
      alignedLyrics: melody.lines,
      lyricsAlignment: { aligned: true, shiftMs: 0, matchedRatio: 1, method: "onset" },
      lyricsSelection: { source: "whisper", wer: null, candidates: [] },
    });
    const none = await seedSong({ lrclibId: 2 });
    const ready = await seedReadySong({ lrclibId: 3 });
    const failed = await seedSong({ lrclibId: 4, referenceStatus: "FAILED", referenceError: "NO_VOICE" });
    const before = await prisma.song.findMany({ where: { id: { in: [none.id, ready.id, failed.id] } }, orderBy: { id: "asc" } });

    const count = await songRepository.failOrphanedProcessing(afterSeed());

    expect(count).toBe(1);
    const stored = await prisma.song.findUniqueOrThrow({ where: { id: processing.id } });
    expect(stored.referenceStatus).toBe("FAILED");
    expect(stored.referenceError).toBe("INTERRUPTED");
    expect(stored.referenceTrack).toBeNull();
    expect(stored.alignedLyrics).toBeNull();
    expect(stored.lyricsAlignment).toBeNull();
    expect(stored.lyricsSelection).toBeNull();
    // O vídeo da tentativa fica, para refazer com ele (só READY serve áudio).
    expect(stored.youtubeVideoId).toBe(VIDEO_ID);
    expect(stored.referenceUpdatedAt!.getTime()).toBeGreaterThan(processing.referenceUpdatedAt!.getTime());

    const after = await prisma.song.findMany({ where: { id: { in: [none.id, ready.id, failed.id] } }, orderBy: { id: "asc" } });
    expect(after).toEqual(before);
  });

  it("não toca no PROCESSING que começou depois da subida (pedido logo após o listen)", async () => {
    const bootedAt = new Date(Date.now() - 1_000);
    const song = await seedSong({ referenceStatus: "PROCESSING", referenceUpdatedAt: new Date() });

    expect(await songRepository.failOrphanedProcessing(bootedAt)).toBe(0);
    expect((await prisma.song.findUniqueOrThrow({ where: { id: song.id } })).referenceStatus).toBe("PROCESSING");
  });

  it("sem nada em PROCESSING devolve 0", async () => {
    await seedReadySong();

    expect(await songRepository.failOrphanedProcessing(afterSeed())).toBe(0);
  });

  it("depois dele, a referência por YouTube aceita a música de novo", async () => {
    const song = await seedSong({ referenceStatus: "PROCESSING", referenceUpdatedAt: new Date(), youtubeVideoId: VIDEO_ID });
    await songRepository.failOrphanedProcessing(afterSeed());
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track));

    const response = await app.inject({
      method: "POST",
      url: `/api/songs/${song.id}/reference/youtube`,
      payload: { url: `https://youtu.be/${VIDEO_ID}` },
    });

    expect(response.statusCode).toBe(202);
    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.referenceError).toBeNull();
  });

  it("o SongDto mostra o INTERRUPTED e o referenceUpdatedAt em ISO", async () => {
    const song = await seedSong({ referenceStatus: "PROCESSING", referenceUpdatedAt: new Date() });
    await songRepository.failOrphanedProcessing(afterSeed());

    const body = (await app.inject({ method: "GET", url: `/api/songs/${song.id}` })).json();

    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(body.referenceStatus).toBe("FAILED");
    expect(body.referenceError).toBe("INTERRUPTED");
    expect(body.referenceUpdatedAt).toBe(stored.referenceUpdatedAt!.toISOString());
  });
});

describe("SongDto.referenceUpdatedAt", () => {
  it("nulo em música que nunca teve referência", async () => {
    const song = await seedSong();

    const body = (await app.inject({ method: "GET", url: `/api/songs/${song.id}` })).json();

    expect(body.referenceUpdatedAt).toBeNull();
  });
});
