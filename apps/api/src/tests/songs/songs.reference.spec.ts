import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, UPLOAD_MAX_BYTES } from "../../app.js";
import { WorkerClientError, workerClient } from "../../clients/worker.client.js";
import { PROCESSING_STALE_MS } from "../../repositories/song.repository.js";
import { prisma } from "../../utils/prisma.js";
import { melody, multipartFile, PERFECT_ALIGNMENT, seedReadySong, seedSong, SONG_MS, waitForReferenceStatus } from "../helpers/songs.js";
import { makeTrack, shiftLines } from "../helpers/tracks.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), fetchYoutubeAudio: vi.fn() },
  };
});

const audio = Buffer.from("nao-e-audio-de-verdade");

function upload(id: string, content = audio) {
  return app.inject({ method: "POST", url: `/api/songs/${id}/reference`, ...multipartFile(content) });
}

function getReference(id: string) {
  return app.inject({ method: "GET", url: `/api/songs/${id}/reference` });
}

beforeEach(() => {
  vi.mocked(workerClient.extract).mockReset();
});

describe("POST /api/songs/:id/reference (upload)", () => {
  it("responde 202 com PROCESSING antes do worker terminar", async () => {
    const song = await seedSong();
    let finish!: () => void;
    vi.mocked(workerClient.extract).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve(melody.track);
      }),
    );

    const response = await upload(song.id);

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "PROCESSING" });

    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.referenceStatus).toBe("PROCESSING");
    expect(stored.referenceUpdatedAt).toBeInstanceOf(Date);
    expect(workerClient.extract).toHaveBeenCalledWith(audio, "musica.mp3");

    finish();
    await waitForReferenceStatus(song.id, "READY");
  });

  it("worker ok → READY com a curva gravada e sem youtubeVideoId", async () => {
    const song = await seedSong({ referenceStatus: "FAILED", referenceError: "NO_VOICE", youtubeVideoId: null });
    vi.mocked(workerClient.extract).mockResolvedValue(melody.track);

    await upload(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.referenceTrack).toEqual(melody.track);
    expect(stored.referenceAudioMs).toBe(SONG_MS);
    expect(stored.referenceError).toBeNull();
    expect(stored.youtubeVideoId).toBeNull();
    expect(stored.alignedLyrics).toEqual(melody.lines);
    expect(stored.lyricsAlignment).toEqual(PERFECT_ALIGNMENT);
  });

  it("ao ficar READY, a letra é alinhada ao áudio da referência (sdd-007)", async () => {
    // Letra cronometrada 3 s atrasada em relação ao áudio que toca.
    const song = await seedSong({ lyrics: shiftLines(melody.lines, 3_000) });
    vi.mocked(workerClient.extract).mockResolvedValue(melody.track);

    await upload(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.alignedLyrics).toEqual(melody.lines);
    expect(stored.lyricsAlignment).toEqual({ aligned: true, shiftMs: -3_000, matchedRatio: 1 });
  });

  it("referência sem relação com a letra → READY sem alignedLyrics e aligned false", async () => {
    const song = await seedSong();
    const unrelated = makeTrack(new Array<number | null>(SONG_MS / 10).fill(60)); // voz contínua: 1 onset só
    vi.mocked(workerClient.extract).mockResolvedValue(unrelated);

    await upload(song.id);

    const stored = await waitForReferenceStatus(song.id, "READY");
    expect(stored.alignedLyrics).toBeNull();
    expect(stored.lyricsAlignment).toMatchObject({ aligned: false });
  });

  it("novo claim e FAILED zeram o alinhamento da referência anterior", async () => {
    const song = await seedSong({
      referenceStatus: "FAILED",
      referenceError: "NO_VOICE",
      alignedLyrics: melody.lines,
      lyricsAlignment: PERFECT_ALIGNMENT,
    });
    let fail!: () => void;
    vi.mocked(workerClient.extract).mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = () => reject(new WorkerClientError("no_voice", "nenhum frame com voz"));
      }),
    );

    await upload(song.id);

    const claimed = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(claimed.referenceStatus).toBe("PROCESSING");
    expect(claimed.alignedLyrics).toBeNull();
    expect(claimed.lyricsAlignment).toBeNull();

    fail();
    const failed = await waitForReferenceStatus(song.id, "FAILED");
    expect(failed.alignedLyrics).toBeNull();
    expect(failed.lyricsAlignment).toBeNull();
  });

  it("worker falha → FAILED com o código traduzido", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.extract).mockRejectedValue(new WorkerClientError("no_voice", "nenhum frame com voz"));

    await upload(song.id);

    const stored = await waitForReferenceStatus(song.id, "FAILED");
    expect(stored.referenceError).toBe("NO_VOICE");
    expect(stored.referenceTrack).toBeNull();
  });

  it("duração divergente da letra em mais de 10 s → FAILED com DURATION_MISMATCH", async () => {
    const song = await seedSong();
    const longer = makeTrack(new Array<number | null>((SONG_MS + 10_010) / 10).fill(60));
    vi.mocked(workerClient.extract).mockResolvedValue(longer);

    await upload(song.id);

    const stored = await waitForReferenceStatus(song.id, "FAILED");
    expect(stored.referenceError).toBe("DURATION_MISMATCH");
    expect(stored.referenceAudioMs).toBe(SONG_MS + 10_010);
  });

  it("duração dentro da tolerância → READY", async () => {
    const song = await seedSong();
    const slightlyLonger = makeTrack(new Array<number | null>((SONG_MS + 9_000) / 10).fill(60));
    vi.mocked(workerClient.extract).mockResolvedValue(slightlyLonger);

    await upload(song.id);

    await waitForReferenceStatus(song.id, "READY");
  });

  it("referência READY não é reprocessada → 409", async () => {
    const song = await seedReadySong();

    const response = await upload(song.id);

    expect(response.statusCode).toBe(409);
    expect(workerClient.extract).not.toHaveBeenCalled();
  });

  it("PROCESSING recente → 409", async () => {
    const song = await seedSong({ referenceStatus: "PROCESSING", referenceUpdatedAt: new Date() });

    const response = await upload(song.id);

    expect(response.statusCode).toBe(409);
    expect(workerClient.extract).not.toHaveBeenCalled();
  });

  it("PROCESSING abandonado (mais de 15 min) aceita novo upload", async () => {
    const song = await seedSong({
      referenceStatus: "PROCESSING",
      referenceUpdatedAt: new Date(Date.now() - PROCESSING_STALE_MS - 1_000),
    });
    vi.mocked(workerClient.extract).mockResolvedValue(melody.track);

    const response = await upload(song.id);

    expect(response.statusCode).toBe(202);
    await waitForReferenceStatus(song.id, "READY");
  });

  it("dois uploads simultâneos → exatamente um 202 e um 409", async () => {
    const song = await seedSong();
    vi.mocked(workerClient.extract).mockResolvedValue(melody.track);

    const responses = await Promise.all([upload(song.id), upload(song.id)]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([202, 409]);
    expect(workerClient.extract).toHaveBeenCalledTimes(1);
    await waitForReferenceStatus(song.id, "READY");
  });

  it("arquivo acima de 20 MB → 413 sem chamar o worker", async () => {
    const song = await seedSong();

    const response = await upload(song.id, Buffer.alloc(UPLOAD_MAX_BYTES + 1));

    expect(response.statusCode).toBe(413);
    expect(workerClient.extract).not.toHaveBeenCalled();
    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.referenceStatus).toBe("NONE");
  });

  it("sem arquivo no multipart → 400", async () => {
    const song = await seedSong();

    const response = await app.inject({
      method: "POST",
      url: `/api/songs/${song.id}/reference`,
      headers: { "content-type": "multipart/form-data; boundary=x" },
      payload: "--x--\r\n",
    });

    expect(response.statusCode).toBe(400);
  });

  it("música inexistente → 404", async () => {
    const response = await upload("019a0000-0000-7000-8000-000000000000");

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/songs/:id/reference", () => {
  it("devolve o PitchTrack quando READY", async () => {
    const song = await seedReadySong();

    const response = await getReference(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(melody.track);
  });

  it.each(["NONE", "PROCESSING", "FAILED"] as const)("status %s → 409", async (status) => {
    const song = await seedSong({ referenceStatus: status, referenceUpdatedAt: new Date() });

    const response = await getReference(song.id);

    expect(response.statusCode).toBe(409);
  });

  it("música inexistente → 404", async () => {
    const response = await getReference("019a0000-0000-7000-8000-000000000000");

    expect(response.statusCode).toBe(404);
  });
});
