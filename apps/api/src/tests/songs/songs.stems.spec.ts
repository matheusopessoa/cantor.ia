import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { WorkerClientError, workerClient } from "../../clients/worker.client.js";
import { multipartFile, seedReadySong, seedSong } from "../helpers/songs.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), fetchYoutubeAudio: vi.fn(), separateStems: vi.fn() },
  };
});

const audio = Buffer.from("nao-e-audio-de-verdade");

/** O que o worker devolve: um multipart/form-data com `vocals` e `instrumental`. */
const BOUNDARY = "cantor-stems-abc123";
const WORKER_BODY = Buffer.from(
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="vocals"; filename="vocals.m4a"\r\nContent-Type: audio/mp4\r\n\r\nVOZ\r\n` +
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="instrumental"; filename="instrumental.m4a"\r\nContent-Type: audio/mp4\r\n\r\nINST\r\n` +
    `--${BOUNDARY}--\r\n`,
);
const WORKER_CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

function stems(id: string, content = audio) {
  return app.inject({ method: "POST", url: `/api/songs/${id}/stems`, ...multipartFile(content, "musica.m4a") });
}

beforeEach(() => {
  vi.mocked(workerClient.separateStems).mockReset();
});

describe("POST /api/songs/:id/stems (sdd-013)", () => {
  it("repassa o multipart do worker com content-type (boundary) e content-length", async () => {
    const song = await seedReadySong();
    vi.mocked(workerClient.separateStems).mockResolvedValue({
      stream: new Blob([WORKER_BODY]).stream(),
      contentType: WORKER_CONTENT_TYPE,
      contentLength: WORKER_BODY.length,
    });

    const response = await stems(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(WORKER_CONTENT_TYPE);
    expect(response.headers["content-length"]).toBe(String(WORKER_BODY.length));
    expect(Buffer.from(response.rawPayload).equals(WORKER_BODY)).toBe(true);
    expect(workerClient.separateStems).toHaveBeenCalledWith(audio, "musica.m4a");
  });

  it("o browser lê a resposta com formData(): vocals e instrumental como arquivos", async () => {
    const song = await seedReadySong();
    vi.mocked(workerClient.separateStems).mockResolvedValue({
      stream: new Blob([WORKER_BODY]).stream(),
      contentType: WORKER_CONTENT_TYPE,
      contentLength: null,
    });

    const response = await stems(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-length"]).toBeUndefined();
    const payload = new Uint8Array(response.rawPayload);
    const form = await new Response(payload, { headers: { "content-type": response.headers["content-type"] as string } }).formData();
    expect([...form.keys()]).toEqual(["vocals", "instrumental"]);
    const vocals = form.get("vocals") as File;
    const instrumental = form.get("instrumental") as File;
    expect(vocals.name).toBe("vocals.m4a");
    expect(vocals.type).toBe("audio/mp4");
    expect(await vocals.text()).toBe("VOZ");
    expect(await instrumental.text()).toBe("INST");
  });

  it("a música não precisa estar READY nem ter youtubeVideoId: o áudio vem do browser", async () => {
    const song = await seedSong({ referenceStatus: "FAILED", referenceError: "NO_VOICE", youtubeVideoId: null });
    vi.mocked(workerClient.separateStems).mockResolvedValue({
      stream: new Blob([WORKER_BODY]).stream(),
      contentType: WORKER_CONTENT_TYPE,
      contentLength: WORKER_BODY.length,
    });

    const response = await stems(song.id);

    expect(response.statusCode).toBe(200);
  });

  it("música inexistente → 404 sem chamar o worker", async () => {
    const response = await stems("019a0000-0000-7000-8000-000000000000");

    expect(response.statusCode).toBe(404);
    expect(workerClient.separateStems).not.toHaveBeenCalled();
  });

  it("sem arquivo no multipart → 400", async () => {
    const song = await seedReadySong();

    const response = await app.inject({
      method: "POST",
      url: `/api/songs/${song.id}/stems`,
      payload: `--x\r\nContent-Disposition: form-data; name="nome"\r\n\r\nvalor\r\n--x--\r\n`,
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });

    expect(response.statusCode).toBe(400);
    expect(workerClient.separateStems).not.toHaveBeenCalled();
  });

  it.each([
    ["unreachable", "worker fora do ar"],
    ["timeout", "passou do tempo"],
    ["invalid_response", "respondeu JSON"],
    ["internal", "erro inesperado"],
  ] as const)("worker falha (%s) → 502 STEMS_UNAVAILABLE", async (code, message) => {
    const song = await seedReadySong();
    vi.mocked(workerClient.separateStems).mockRejectedValue(new WorkerClientError(code, message));

    const response = await stems(song.id);

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ message: expect.any(String), code: "STEMS_UNAVAILABLE" });
    expect(response.body).not.toContain(message);
  });

  it.each([
    ["too_large", 413, "TOO_LARGE"],
    ["invalid_audio", 415, "INVALID_AUDIO"],
    ["too_long", 422, "TOO_LONG"],
  ] as const)("worker recusa o áudio (%s) → %i %s, como no upload da referência", async (code, status, apiCode) => {
    const song = await seedReadySong();
    vi.mocked(workerClient.separateStems).mockRejectedValue(new WorkerClientError(code, "recusado"));

    const response = await stems(song.id);

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ message: expect.any(String), code: apiCode });
  });
});
