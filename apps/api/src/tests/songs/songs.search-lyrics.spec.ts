import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { lrclibClient, type LrclibTrack } from "../../clients/lrclib.client.js";
import { LyricsProviderUnavailableError } from "../../utils/errors.js";
import { seedSong, VIDEO_ID } from "../helpers/songs.js";

vi.mock("../../clients/lrclib.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/lrclib.client.js")>();
  return { ...original, lrclibClient: { search: vi.fn(), getById: vi.fn(), find: vi.fn() } };
});

function track(id: number, overrides: Partial<LrclibTrack> = {}): LrclibTrack {
  return {
    id,
    trackName: `Faixa ${id}`,
    artistName: "Artista",
    albumName: "Álbum",
    duration: 60,
    syncedLyrics: "[00:01.00]oi",
    plainLyrics: "oi",
    ...overrides,
  };
}

function search(q: string) {
  return app.inject({ method: "GET", url: "/api/songs/search/lyrics", query: { q } });
}

beforeEach(() => {
  vi.mocked(lrclibClient.search).mockReset();
});

/** Busca pela letra no LRCLIB (sdd-015), de volta como caminho principal. */
describe("GET /api/songs/search/lyrics", () => {
  it("devolve só faixas com letra sincronizada, em ms", async () => {
    vi.mocked(lrclibClient.search).mockResolvedValue([
      track(1),
      track(2, { syncedLyrics: null }),
      track(3, { duration: 201.5, albumName: null }),
    ]);

    const response = await search("tempo perdido");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { lrclibId: 1, artist: "Artista", title: "Faixa 1", album: "Álbum", durationMs: 60_000, songId: null, referenceStatus: null, youtubeVideoId: null },
      { lrclibId: 3, artist: "Artista", title: "Faixa 3", album: null, durationMs: 201_500, songId: null, referenceStatus: null, youtubeVideoId: null },
    ]);
    expect(lrclibClient.search).toHaveBeenCalledWith("tempo perdido");
  });

  it("anexa songId, referenceStatus e youtubeVideoId das músicas já cadastradas, em 1 query", async () => {
    const song = await seedSong({ lrclibId: 2, referenceStatus: "READY", youtubeVideoId: VIDEO_ID });
    // Música nova (pelo vídeo) com o mesmo vídeo não entra: a busca pela letra casa só por lrclibId.
    await seedSong({ lrclibId: null, sourceVideoId: "abcdefghijk", youtubeVideoId: "abcdefghijk" });
    vi.mocked(lrclibClient.search).mockResolvedValue([track(1), track(2)]);

    const response = await search("qualquer");

    expect(response.json()).toMatchObject([
      { lrclibId: 1, songId: null, referenceStatus: null, youtubeVideoId: null },
      { lrclibId: 2, songId: song.id, referenceStatus: "READY", youtubeVideoId: VIDEO_ID },
    ]);
  });

  it("limita a 20 resultados", async () => {
    vi.mocked(lrclibClient.search).mockResolvedValue(Array.from({ length: 25 }, (_, index) => track(index + 1)));

    const response = await search("muitas");

    expect(response.json()).toHaveLength(20);
  });

  it.each(["a", " ", "x".repeat(101)])("q inválido (%j) → 400 sem consultar o LRCLIB", async (q) => {
    const response = await search(q);

    expect(response.statusCode).toBe(400);
    expect(lrclibClient.search).not.toHaveBeenCalled();
  });

  it("LRCLIB fora → 502 LYRICS_UNAVAILABLE", async () => {
    vi.mocked(lrclibClient.search).mockRejectedValue(new LyricsProviderUnavailableError());

    const response = await search("tempo perdido");

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("LYRICS_UNAVAILABLE");
  });
});
