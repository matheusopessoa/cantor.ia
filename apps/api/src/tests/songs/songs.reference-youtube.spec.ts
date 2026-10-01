import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { WorkerClientError, workerClient, type WorkerClientErrorCode } from "../../clients/worker.client.js";
import { prisma } from "../../utils/prisma.js";
import { extraction, KNOWN_LYRICS, melody, multipartFile, seedReadySong, seedSong, SONG_MS, VIDEO_ID, waitForReferenceStatus } from "../helpers/songs.js";
import { forcedFrom, makeTrack, shiftLines } from "../helpers/tracks.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), fetchYoutubeAudio: vi.fn() },
  };
});

const URL = `https://www.youtube.com/watch?v=${VIDEO_ID}&t=10s`;

function fromYoutube(id: string, url = URL, extra: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: `/api/songs/${id}/reference/youtube`, payload: { url, ...extra } });
}

beforeEach(() => {
  vi.mocked(workerClient.extractFromYoutube).mockReset();
  vi.mocked(workerClient.extract).mockReset();
});

describe("POST /api/songs/:id/reference/youtube", () => {
  it("responde 202 com PROCESSING e o videoId, já gravado para a miniatura", async () => {
    const song = await seedSong();
    let finish!: () => void;
    vi.mocked(workerClient.extractFromYoutube).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve(extraction(melody.track));
      }),
    );

    const response = await fromYoutube(song.id);

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "PROCESSING", youtubeVideoId: VIDEO_ID });

    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.referenceStatus).toBe("PROCESSING");
    expect(stored.youtubeVideoId).toBe(VIDEO_ID);
    // Só o videoId vai para o worker, nunca a URL colada (regra 11).
    expect(workerClient.extractFromYoutube).toHaveBeenCalledWith(VIDEO_ID, KNOWN_LYRICS, { stems: true });

    finish();
    await waitForReferenceStatus(song.id, "READY");
  });

  it("worker ok → READY mantendo o youtubeVideoId", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.referenceTrack).toEqual(melody.track);
    expect(stored.youtubeVideoId).toBe(VIDEO_ID);
    expect(stored.referenceAudioMs).toBe(SONG_MS);
  });

  it("worker ok → letra alinhada ao áudio do vídeo (sdd-007)", async () => {
    const song = await seedSong({ lyrics: shiftLines(melody.lines, 1_500) });
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.alignedLyrics).toEqual(melody.lines);
    expect(stored.lyricsAlignment).toEqual({ aligned: true, shiftMs: -1_500, matchedRatio: 1, method: "onset" });
  });

  it.each<[WorkerClientErrorCode, string]>([
    ["video_unavailable", "VIDEO_UNAVAILABLE"],
    ["too_long", "TOO_LONG"],
    ["no_voice", "NO_VOICE"],
    ["download_failed", "DOWNLOAD_FAILED"],
    ["timeout", "DOWNLOAD_FAILED"],
    ["invalid_audio", "INVALID_AUDIO"],
    ["too_large", "INVALID_AUDIO"],
    ["internal", "INTERNAL"],
    ["invalid_video_id", "INTERNAL"],
    ["unreachable", "INTERNAL"],
    ["invalid_response", "INTERNAL"],
  ])("worker falha com %s → FAILED com %s e youtubeVideoId nulo", async (workerCode, referenceError) => {
    const song = await seedSong();
    vi.mocked(workerClient.extractFromYoutube).mockRejectedValue(new WorkerClientError(workerCode, "log"));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "FAILED");
    expect(stored.referenceError).toBe(referenceError);
    expect(stored.youtubeVideoId).toBeNull();
    expect(stored.referenceTrack).toBeNull();
    expect(stored.alignedLyrics).toBeNull();
    expect(stored.lyricsAlignment).toBeNull();
  });

  it("erro que não é do worker → FAILED com INTERNAL", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.extractFromYoutube).mockRejectedValue(new Error("qualquer coisa"));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "FAILED");
    expect(stored.referenceError).toBe("INTERNAL");
  });

  it("duração divergente → FAILED com DURATION_MISMATCH e referenceAudioMs", async () => {
    const song = await seedSong();
    const shorter = makeTrack(new Array<number | null>((SONG_MS - 20_000) / 10).fill(60));
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(shorter));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "FAILED");
    expect(stored.referenceError).toBe("DURATION_MISMATCH");
    expect(stored.referenceAudioMs).toBe(SONG_MS - 20_000);
    expect(stored.youtubeVideoId).toBeNull();
  });

  it.each([
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://vimeo.com/123",
    "texto solto",
    "javascript:alert(1)",
  ])("link inválido %s → 400 INVALID_YOUTUBE_URL sem chamar o worker", async (url) => {
    const song = await seedSong();

    const response = await fromYoutube(song.id, url);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_YOUTUBE_URL" });
    expect(workerClient.extractFromYoutube).not.toHaveBeenCalled();
    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.referenceStatus).toBe("NONE");
  });

  it("corpo sem url → 400", async () => {
    const song = await seedSong();

    const response = await app.inject({
      method: "POST",
      url: `/api/songs/${song.id}/reference/youtube`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("referência READY → 409", async () => {
    const song = await seedReadySong();

    const response = await fromYoutube(song.id);

    expect(response.statusCode).toBe(409);
    expect(workerClient.extractFromYoutube).not.toHaveBeenCalled();
  });

  it("música inexistente → 404", async () => {
    const response = await fromYoutube("019a0000-0000-7000-8000-000000000000");

    expect(response.statusCode).toBe(404);
  });

  it("concorrência com o upload → um 202 e um 409", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track));
    vi.mocked(workerClient.extract).mockResolvedValue(extraction(melody.track));

    const responses = await Promise.all([
      fromYoutube(song.id),
      app.inject({ method: "POST", url: `/api/songs/${song.id}/reference`, ...multipartFile(Buffer.from("x")) }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([202, 409]);
    expect(
      vi.mocked(workerClient.extractFromYoutube).mock.calls.length +
        vi.mocked(workerClient.extract).mock.calls.length,
    ).toBe(1);
    await waitForReferenceStatus(song.id, "READY");
  });
});

// ─── Alinhamento forçado e redo (sdd-010) ────────────────────────────────────

describe("POST /api/songs/:id/reference/youtube — sdd-010", () => {
  it("worker devolve o alinhamento → letra alinhada pelo texto, method forced", async () => {
    const song = await seedSong({ lyrics: shiftLines(melody.lines, 1_500) });
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, forcedFrom(melody.lines)));

    await fromYoutube(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.alignedLyrics).toEqual(melody.lines);
    expect(stored.lyricsAlignment).toEqual({ aligned: true, shiftMs: -1_500, matchedRatio: 1, method: "forced" });
  });

  it("READY + redo → 202, PROCESSING com o novo videoId e o alinhamento zerado", async () => {
    const song = await seedReadySong({ youtubeVideoId: "aaaaaaaaaaa" });
    let finish!: () => void;
    vi.mocked(workerClient.extractFromYoutube).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve(extraction(melody.track, forcedFrom(melody.lines)));
      }),
    );

    const response = await fromYoutube(song.id, URL, { redo: true });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "PROCESSING", youtubeVideoId: VIDEO_ID });
    const claimed = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(claimed.referenceStatus).toBe("PROCESSING");
    expect(claimed.youtubeVideoId).toBe(VIDEO_ID);
    expect(claimed.alignedLyrics).toBeNull();
    expect(claimed.lyricsAlignment).toBeNull();
    expect(workerClient.extractFromYoutube).toHaveBeenCalledWith(VIDEO_ID, KNOWN_LYRICS, { stems: true });

    finish();
    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.lyricsAlignment).toMatchObject({ method: "forced" });
  });

  it("READY com redo false → 409", async () => {
    const song = await seedReadySong();

    const response = await fromYoutube(song.id, URL, { redo: false });

    expect(response.statusCode).toBe(409);
    expect(workerClient.extractFromYoutube).not.toHaveBeenCalled();
  });

  it("PROCESSING recente + redo → 409", async () => {
    const song = await seedSong({ referenceStatus: "PROCESSING", referenceUpdatedAt: new Date() });

    const response = await fromYoutube(song.id, URL, { redo: true });

    expect(response.statusCode).toBe(409);
    expect(workerClient.extractFromYoutube).not.toHaveBeenCalled();
  });

  it("redo que não é booleano → 400", async () => {
    const song = await seedReadySong();

    const response = await fromYoutube(song.id, URL, { redo: "true" });

    expect(response.statusCode).toBe(400);
  });
});
