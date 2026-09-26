import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { Prisma } from "../../generated/prisma/client.js";
import { songRepository } from "../../repositories/song.repository.js";
import { prisma } from "../../utils/prisma.js";
import { melody, PERFECT_ALIGNMENT, seedReadySong, seedSong } from "../helpers/songs.js";
import { randomNotes, shiftLines } from "../helpers/tracks.js";

/** Música READY gravada antes da sdd-007: sem alinhamento. */
const LEGACY = { alignedLyrics: Prisma.DbNull, lyricsAlignment: Prisma.DbNull };

function get(id: string) {
  return app.inject({ method: "GET", url: `/api/songs/${id}` });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/songs/:id — alinhamento da letra (sdd-007)", () => {
  it("devolve alignedLyrics e lyricsAlignment, sem referenceTrack", async () => {
    const song = await seedReadySong();

    const response = await get(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ alignedLyrics: melody.lines, lyricsAlignment: PERFECT_ALIGNMENT });
    expect(response.json()).not.toHaveProperty("referenceTrack");
  });

  it("READY anterior à sdd-007 é alinhada e gravada na primeira leitura (backfill)", async () => {
    const song = await seedReadySong({ lyrics: shiftLines(melody.lines, 3_000), ...LEGACY });

    const response = await get(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.json().alignedLyrics).toEqual(melody.lines);
    expect(response.json().lyricsAlignment).toEqual({ aligned: true, shiftMs: -3_000, matchedRatio: 1, method: "onset" });

    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.alignedLyrics).toEqual(melody.lines);
    expect(stored.lyricsAlignment).toEqual({ aligned: true, shiftMs: -3_000, matchedRatio: 1, method: "onset" });
  });

  it("segunda leitura não carrega a referência nem regrava", async () => {
    const song = await seedReadySong({ ...LEGACY });
    const load = vi.spyOn(songRepository, "findWithReference");
    const save = vi.spyOn(songRepository, "saveAlignment");

    await get(song.id);
    await get(song.id);

    expect(load).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("backfill que não bate grava aligned false e também não repete", async () => {
    const song = await seedReadySong({ referenceTrack: randomNotes(7, 60_000), ...LEGACY });
    const save = vi.spyOn(songRepository, "saveAlignment");

    const first = await get(song.id);
    const second = await get(song.id);

    expect(first.json().alignedLyrics).toBeNull();
    expect(first.json().lyricsAlignment).toMatchObject({ aligned: false });
    expect(second.json()).toEqual(first.json());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("READY já alinhada não consulta o referenceTrack", async () => {
    const song = await seedReadySong();
    const load = vi.spyOn(songRepository, "findWithReference");

    await get(song.id);

    expect(load).not.toHaveBeenCalled();
  });

  it.each(["NONE", "PROCESSING", "FAILED"] as const)("status %s → campos nulos e sem backfill", async (status) => {
    const song = await seedSong({ referenceStatus: status, referenceUpdatedAt: new Date() });
    const load = vi.spyOn(songRepository, "findWithReference");

    const response = await get(song.id);

    expect(response.json()).toMatchObject({ alignedLyrics: null, lyricsAlignment: null });
    expect(load).not.toHaveBeenCalled();
  });
});

describe("GET /api/songs/:id — method do alinhamento (sdd-010)", () => {
  it("devolve o method gravado, sem backfill", async () => {
    const song = await seedReadySong({ lyricsAlignment: { aligned: true, shiftMs: -9_980, matchedRatio: 0.825, method: "forced" } });
    const load = vi.spyOn(songRepository, "findWithReference");

    const response = await get(song.id);

    expect(response.json().lyricsAlignment).toEqual({ aligned: true, shiftMs: -9_980, matchedRatio: 0.825, method: "forced" });
    expect(load).not.toHaveBeenCalled();
  });

  it("registro da sdd-007 (sem method) continua válido e não é reprocessado", async () => {
    const legacy = { aligned: true, shiftMs: 80, matchedRatio: 0.563 };
    const song = await seedReadySong({ lyricsAlignment: legacy });
    const save = vi.spyOn(songRepository, "saveAlignment");

    const response = await get(song.id);

    expect(response.json().lyricsAlignment).toEqual(legacy);
    expect(save).not.toHaveBeenCalled();
  });
});
