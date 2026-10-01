import { beforeEach, describe, expect, it, vi } from "vitest";
import { lrclibClient, type LrclibTrack } from "../../clients/lrclib.client.js";
import { WorkerClientError, workerClient, type WorkerYtmusicSong } from "../../clients/worker.client.js";
import { lrclibCandidates, lyricsSourceService, ytmusicCandidate } from "../../services/lyrics-source.service.js";
import { LyricsProviderUnavailableError } from "../../utils/errors.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return { ...original, workerClient: { getYtmusicSong: vi.fn() } };
});

vi.mock("../../clients/lrclib.client.js", () => ({ lrclibClient: { find: vi.fn() } }));

const SONG = { artist: "Tim Bernardes", title: "Olha", durationMs: 260_000, videoId: "-YDEZ8xiazI" };

function track(id: number, overrides: Partial<LrclibTrack> = {}): LrclibTrack {
  return {
    id,
    trackName: "Olha",
    artistName: "Tim Bernardes",
    albumName: null,
    duration: 260,
    syncedLyrics: null,
    plainLyrics: null,
    ...overrides,
  };
}

describe("lrclibCandidates", () => {
  it("fica só com a duração da música (±10 s), a sincronizada antes da de texto, no máximo 2", () => {
    const candidates = lrclibCandidates(
      [
        track(1, { plainLyrics: "texto um" }),
        track(2, { duration: 280, syncedLyrics: "[00:01.00]longe demais" }),
        track(3, { duration: 251, syncedLyrics: "[00:01.00]sincronizada\n[00:03.50]de verdade" }),
        track(4, { plainLyrics: "texto quatro" }),
      ],
      SONG,
    );

    expect(candidates).toEqual([
      {
        source: "lrclib",
        lines: [
          { startMs: 1_000, text: "sincronizada" },
          { startMs: 3_500, text: "de verdade" },
        ],
      },
      { source: "lrclib", lines: [{ text: "texto um", startMs: null }] },
    ]);
  });

  it("texto vira uma linha por linha não vazia; faixa sem letra nenhuma não entra", () => {
    const candidates = lrclibCandidates([track(1), track(2, { plainLyrics: " Olha \r\n\r\n  como é  \n" })], SONG);

    expect(candidates).toEqual([
      {
        source: "lrclib",
        lines: [
          { text: "Olha", startMs: null },
          { text: "como é", startMs: null },
        ],
      },
    ]);
  });
});

describe("ytmusicCandidate", () => {
  it("synced e plain viram candidata, sem o endMs", () => {
    expect(
      ytmusicCandidate({ status: "synced", source: "Musixmatch", lines: [{ text: "Olha", startMs: 960, endMs: 5_000 }] }),
    ).toEqual({ source: "ytmusic", lines: [{ text: "Olha", startMs: 960 }] });
    expect(ytmusicCandidate({ status: "plain", source: null, lines: [{ text: "Olha", startMs: null, endMs: null }] })).toEqual({
      source: "ytmusic",
      lines: [{ text: "Olha", startMs: null }],
    });
  });

  it.each(["none", "error"] as const)("status %s → null", (status) => {
    expect(ytmusicCandidate({ status, source: null, lines: [] })).toBeNull();
  });

  it("letra sem linhas → null", () => {
    expect(ytmusicCandidate({ status: "plain", source: null, lines: [] })).toBeNull();
  });
});

describe("lyricsSourceService.collect", () => {
  const ytmusic: WorkerYtmusicSong = {
    videoId: SONG.videoId,
    title: "Olha",
    artist: "Tim Bernardes",
    album: null,
    durationS: 260,
    lyrics: { status: "plain", source: "LyricFind", lines: [{ text: "Olha", startMs: null, endMs: null }] },
  };

  beforeEach(() => {
    vi.mocked(workerClient.getYtmusicSong).mockReset().mockResolvedValue(ytmusic);
    vi.mocked(lrclibClient.find).mockReset().mockResolvedValue([track(1, { plainLyrics: "Olha do LRCLIB" })]);
  });

  it("junta YouTube Music (primeiro) e LRCLIB", async () => {
    const candidates = await lyricsSourceService.collect(SONG);

    expect(candidates.map((c) => c.source)).toEqual(["ytmusic", "lrclib"]);
    expect(workerClient.getYtmusicSong).toHaveBeenCalledWith(SONG.videoId);
    expect(lrclibClient.find).toHaveBeenCalledWith({ artist: "Tim Bernardes", title: "Olha" });
  });

  it("YouTube Music fora do ar: fica o LRCLIB", async () => {
    vi.mocked(workerClient.getYtmusicSong).mockRejectedValue(new WorkerClientError("search_failed", "fora"));

    expect((await lyricsSourceService.collect(SONG)).map((c) => c.source)).toEqual(["lrclib"]);
  });

  it("LRCLIB fora do ar: fica o YouTube Music", async () => {
    vi.mocked(lrclibClient.find).mockRejectedValue(new LyricsProviderUnavailableError());

    expect((await lyricsSourceService.collect(SONG)).map((c) => c.source)).toEqual(["ytmusic"]);
  });

  it("as duas fora: lista vazia (o worker usa a transcrição)", async () => {
    vi.mocked(workerClient.getYtmusicSong).mockRejectedValue(new Error("fora"));
    vi.mocked(lrclibClient.find).mockRejectedValue(new Error("fora"));

    expect(await lyricsSourceService.collect(SONG)).toEqual([]);
  });

  it("sem vídeo não consulta o YouTube Music", async () => {
    await lyricsSourceService.collect({ ...SONG, videoId: null });

    expect(workerClient.getYtmusicSong).not.toHaveBeenCalled();
  });
});
