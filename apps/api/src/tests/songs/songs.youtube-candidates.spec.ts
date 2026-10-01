import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { WorkerClientError, workerClient, type WorkerYoutubeCandidate } from "../../clients/worker.client.js";
import { SUGGESTION_CONFIG, youtubeSuggestionService } from "../../services/youtube-suggestion.service.js";
import { prisma } from "../../utils/prisma.js";
import { seedSong, SONG_MS, VIDEO_ID } from "../helpers/songs.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), fetchYoutubeAudio: vi.fn(), searchYoutube: vi.fn() },
  };
});

const CANDIDATES: WorkerYoutubeCandidate[] = [
  { videoId: "AAAAAAAAAAA", title: "Música", channel: "Qualquer", durationS: SONG_MS / 1000, viewCount: 5_000, isLive: false },
  { videoId: VIDEO_ID, title: "Música", channel: "Artista - Topic", durationS: SONG_MS / 1000, viewCount: 100, isLive: false },
  { videoId: "BBBBBBBBBBB", title: "Música", channel: "Outro", durationS: SONG_MS / 1000 + 30, viewCount: 1, isLive: false },
];

function getCandidates(id: string) {
  return app.inject({ method: "GET", url: `/api/songs/${id}/youtube-candidates` });
}

beforeEach(() => {
  vi.mocked(workerClient.searchYoutube).mockReset();
  youtubeSuggestionService.clearCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/songs/:id/youtube-candidates", () => {
  it("200 com os candidatos ranqueados, a consulta e a confiança", async () => {
    const song = await seedSong({ artist: "Artista", title: "Música (Remastered)" });
    vi.mocked(workerClient.searchYoutube).mockResolvedValue(CANDIDATES);

    const response = await getCandidates(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      query: "Artista Música",
      confidence: "high",
      candidates: [
        {
          videoId: VIDEO_ID,
          title: "Música",
          channel: "Artista - Topic",
          durationMs: SONG_MS,
          viewCount: 100,
          score: 3 + 2 + 1,
          tier: 1,
          reasons: ["TOPIC_CHANNEL", "ARTIST_CHANNEL", "EXACT_DURATION"],
        },
        {
          videoId: "AAAAAAAAAAA",
          title: "Música",
          channel: "Qualquer",
          durationMs: SONG_MS,
          viewCount: 5_000,
          score: 1,
          tier: 2,
          reasons: ["EXACT_DURATION", "MOST_VIEWED"],
        },
      ],
    });
    // A consulta vem do LRCLIB (artista + título), nunca de texto do usuário (regra 8).
    expect(workerClient.searchYoutube).toHaveBeenCalledWith("Artista Música");
  });

  it("não muda o status da música", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.searchYoutube).mockResolvedValue(CANDIDATES);

    await getCandidates(song.id);

    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.referenceStatus).toBe("NONE");
    expect(stored.youtubeVideoId).toBeNull();
  });

  it("lista vazia do worker → 200 com confidence none", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.searchYoutube).mockResolvedValue([]);

    const response = await getCandidates(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ confidence: "none", candidates: [] });
  });

  it("música inexistente → 404 sem chamar o worker", async () => {
    const response = await getCandidates("019a0000-0000-7000-8000-000000000000");

    expect(response.statusCode).toBe(404);
    expect(workerClient.searchYoutube).not.toHaveBeenCalled();
  });

  it("id que não é uuid → 400", async () => {
    const response = await getCandidates("nope");

    expect(response.statusCode).toBe(400);
  });

  it.each([
    new WorkerClientError("search_failed", "log"),
    new WorkerClientError("timeout", "log"),
    new WorkerClientError("unreachable", "log"),
    new Error("qualquer coisa"),
  ])("worker falha (%s) → 502 SEARCH_FAILED, e a falha não fica em cache", async (error) => {
    const song = await seedSong();
    vi.mocked(workerClient.searchYoutube).mockRejectedValueOnce(error).mockResolvedValue(CANDIDATES);

    const failed = await getCandidates(song.id);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ message: "YouTube search is unavailable", code: "SEARCH_FAILED" });

    const retried = await getCandidates(song.id);
    expect(retried.statusCode).toBe(200);
    expect(workerClient.searchYoutube).toHaveBeenCalledTimes(2);
  });

  it("segunda chamada dentro de 10 min não chama o worker; depois do TTL chama de novo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-09-26T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    const song = await seedSong();
    vi.mocked(workerClient.searchYoutube).mockResolvedValue(CANDIDATES);

    const first = await getCandidates(song.id);
    vi.setSystemTime(t0 + SUGGESTION_CONFIG.cache.ttlMs - 1);
    const second = await getCandidates(song.id);

    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(workerClient.searchYoutube).toHaveBeenCalledTimes(1);

    vi.setSystemTime(t0 + SUGGESTION_CONFIG.cache.ttlMs);
    const third = await getCandidates(song.id);

    expect(third.statusCode).toBe(200);
    expect(workerClient.searchYoutube).toHaveBeenCalledTimes(2);
  });

  it("o cache é por música", async () => {
    const a = await seedSong({ lrclibId: 1 });
    const b = await seedSong({ lrclibId: 2, title: "Outra" });
    vi.mocked(workerClient.searchYoutube).mockResolvedValue(CANDIDATES);

    await getCandidates(a.id);
    await getCandidates(b.id);
    await getCandidates(a.id);

    expect(workerClient.searchYoutube).toHaveBeenCalledTimes(2);
  });
});
