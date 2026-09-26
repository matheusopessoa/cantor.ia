import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { WorkerClientError, workerClient } from "../../clients/worker.client.js";
import { seedReadySong, seedSong, VIDEO_ID } from "../helpers/songs.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), fetchYoutubeAudio: vi.fn() },
  };
});

const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]);

function audio(id: string) {
  return app.inject({ method: "GET", url: `/api/songs/${id}/audio` });
}

beforeEach(() => {
  vi.mocked(workerClient.fetchYoutubeAudio).mockReset();
});

describe("GET /api/songs/:id/audio", () => {
  it("READY com youtubeVideoId → repassa bytes, content-type e content-length", async () => {
    const song = await seedReadySong();
    vi.mocked(workerClient.fetchYoutubeAudio).mockResolvedValue({
      stream: new Blob([bytes]).stream(),
      contentType: "audio/mp4",
      contentLength: bytes.length,
    });

    const response = await audio(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("audio/mp4");
    expect(response.headers["content-length"]).toBe(String(bytes.length));
    expect(new Uint8Array(response.rawPayload)).toEqual(bytes);
    expect(workerClient.fetchYoutubeAudio).toHaveBeenCalledWith(VIDEO_ID);
  });

  it("sem content-length do worker → responde sem o header, com os bytes", async () => {
    const song = await seedReadySong();
    vi.mocked(workerClient.fetchYoutubeAudio).mockResolvedValue({
      stream: new Blob([bytes]).stream(),
      contentType: "audio/mpeg",
      contentLength: null,
    });

    const response = await audio(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("audio/mpeg");
    expect(new Uint8Array(response.rawPayload)).toEqual(bytes);
  });

  it("PROCESSING → 404 sem chamar o worker", async () => {
    const song = await seedSong({
      referenceStatus: "PROCESSING",
      youtubeVideoId: VIDEO_ID,
      referenceUpdatedAt: new Date(),
    });

    const response = await audio(song.id);

    expect(response.statusCode).toBe(404);
    expect(workerClient.fetchYoutubeAudio).not.toHaveBeenCalled();
  });

  it("READY vinda de upload (sem youtubeVideoId) → 404", async () => {
    const song = await seedReadySong({ youtubeVideoId: null });

    const response = await audio(song.id);

    expect(response.statusCode).toBe(404);
    expect(workerClient.fetchYoutubeAudio).not.toHaveBeenCalled();
  });

  it("worker falha → 502 com code DOWNLOAD_FAILED", async () => {
    const song = await seedReadySong();
    vi.mocked(workerClient.fetchYoutubeAudio).mockRejectedValue(
      new WorkerClientError("download_failed", "yt-dlp quebrou"),
    );

    const response = await audio(song.id);

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ message: expect.any(String), code: "DOWNLOAD_FAILED" });
    expect(response.body).not.toContain("yt-dlp");
  });

  it("música inexistente → 404", async () => {
    const response = await audio("019a0000-0000-7000-8000-000000000000");

    expect(response.statusCode).toBe(404);
  });
});
