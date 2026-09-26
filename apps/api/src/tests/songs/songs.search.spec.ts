import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { WorkerClientError, workerClient, type WorkerYtmusicSong } from "../../clients/worker.client.js";
import { seedReadySong, seedSong, VIDEO_ID } from "../helpers/songs.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return { ...original, workerClient: { searchYtmusic: vi.fn() } };
});

const OTHER_ID = "aaaaaaaaaaa";
const THIRD_ID = "bbbbbbbbbbb";

function result(videoId: string, overrides: Partial<WorkerYtmusicSong> = {}): WorkerYtmusicSong {
  return {
    videoId,
    title: `Faixa ${videoId}`,
    artist: "Artista",
    album: "Álbum",
    durationS: 201.5,
    lyrics: { status: "none", source: null, lines: [] },
    ...overrides,
  };
}

function search(q: string) {
  return app.inject({ method: "GET", url: "/api/songs/search", query: { q } });
}

beforeEach(() => {
  vi.mocked(workerClient.searchYtmusic).mockReset();
});

describe("GET /api/songs/search (sdd-011: YouTube Music)", () => {
  it("devolve os resultados do YouTube Music, em ms, sem letra", async () => {
    vi.mocked(workerClient.searchYtmusic).mockResolvedValue([result(VIDEO_ID), result(OTHER_ID, { album: null, durationS: null })]);

    const response = await search("tim bernardes");

    expect(response.statusCode).toBe(200);
    expect(workerClient.searchYtmusic).toHaveBeenCalledWith("tim bernardes");
    expect(response.json()).toEqual([
      { videoId: VIDEO_ID, artist: "Artista", title: `Faixa ${VIDEO_ID}`, album: "Álbum", durationMs: 201_500, songId: null, referenceStatus: null },
      { videoId: OTHER_ID, artist: "Artista", title: `Faixa ${OTHER_ID}`, album: null, durationMs: null, songId: null, referenceStatus: null },
    ]);
  });

  it("anexa o estado da música nova (pelo vídeo escolhido) e da antiga (pelo vídeo da referência)", async () => {
    const created = await seedSong({ lrclibId: null, sourceVideoId: VIDEO_ID, lyrics: [] });
    const legacy = await seedReadySong({ lrclibId: 55, youtubeVideoId: OTHER_ID });
    vi.mocked(workerClient.searchYtmusic).mockResolvedValue([result(VIDEO_ID), result(OTHER_ID), result(THIRD_ID)]);

    const items = (await search("artista")).json();

    expect(items.map((item: { songId: string | null; referenceStatus: string | null }) => [item.songId, item.referenceStatus])).toEqual([
      [created.id, "NONE"],
      [legacy.id, "READY"],
      [null, null],
    ]);
  });

  it("vídeo que é o escolhido de uma música e a referência de outra: vale a nova", async () => {
    const legacy = await seedReadySong({ lrclibId: 55, youtubeVideoId: VIDEO_ID });
    const created = await seedSong({ lrclibId: null, sourceVideoId: VIDEO_ID, lyrics: [] });
    vi.mocked(workerClient.searchYtmusic).mockResolvedValue([result(VIDEO_ID)]);

    const [item] = (await search("artista")).json();

    expect(item.songId).toBe(created.id);
    expect(item.songId).not.toBe(legacy.id);
  });

  it.each(["a", " ", "x".repeat(101)])("q inválido (%j) → 400 sem chamar o worker", async (q) => {
    const response = await search(q);

    expect(response.statusCode).toBe(400);
    expect(workerClient.searchYtmusic).not.toHaveBeenCalled();
  });

  it("worker ou YouTube Music fora do ar → 502 SEARCH_FAILED", async () => {
    vi.mocked(workerClient.searchYtmusic).mockRejectedValue(new WorkerClientError("search_failed", "ytmusicapi quebrou"));

    const response = await search("artista");

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("SEARCH_FAILED");
  });
});
