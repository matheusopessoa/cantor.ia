import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { lrclibClient, type LrclibTrack } from "../../clients/lrclib.client.js";
import { prisma } from "../../utils/prisma.js";

vi.mock("../../clients/lrclib.client.js", () => ({
  lrclibClient: { search: vi.fn(), getById: vi.fn() },
}));

const lrclibTrack: LrclibTrack = {
  id: 77,
  trackName: "Faixa",
  artistName: "Artista",
  albumName: "Álbum",
  duration: 180.4,
  syncedLyrics: "[ar:Artista]\n[00:01.00]primeira\n[00:05.50]segunda",
};

function create(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/songs", payload: body });
}

beforeEach(() => {
  vi.mocked(lrclibClient.getById).mockReset();
});

describe("POST /api/songs", () => {
  it("cadastra a música com a letra parseada e responde 201", async () => {
    vi.mocked(lrclibClient.getById).mockResolvedValue(lrclibTrack);

    const response = await create({ lrclibId: 77 });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      lrclibId: 77,
      artist: "Artista",
      title: "Faixa",
      album: "Álbum",
      durationMs: 180_400,
      lyrics: [
        { startMs: 1_000, text: "primeira" },
        { startMs: 5_500, text: "segunda" },
      ],
      referenceStatus: "NONE",
      referenceError: null,
      referenceAudioMs: null,
      youtubeVideoId: null,
    });
    expect(response.json()).not.toHaveProperty("referenceTrack");
  });

  it("segunda chamada devolve a mesma música com 200, sem consultar o LRCLIB de novo", async () => {
    vi.mocked(lrclibClient.getById).mockResolvedValue(lrclibTrack);
    const first = await create({ lrclibId: 77 });

    const second = await create({ lrclibId: 77 });

    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(lrclibClient.getById).toHaveBeenCalledTimes(1);
    expect(await prisma.song.count()).toBe(1);
  });

  it("id inexistente no LRCLIB → 404", async () => {
    vi.mocked(lrclibClient.getById).mockResolvedValue(null);

    const response = await create({ lrclibId: 404 });

    expect(response.statusCode).toBe(404);
    expect(await prisma.song.count()).toBe(0);
  });

  it("faixa sem letra sincronizada → 422", async () => {
    vi.mocked(lrclibClient.getById).mockResolvedValue({ ...lrclibTrack, syncedLyrics: null });

    const response = await create({ lrclibId: 77 });

    expect(response.statusCode).toBe(422);
    expect(await prisma.song.count()).toBe(0);
  });

  it("letra sincronizada sem nenhuma tag de tempo → 422", async () => {
    vi.mocked(lrclibClient.getById).mockResolvedValue({ ...lrclibTrack, syncedLyrics: "só texto" });

    const response = await create({ lrclibId: 77 });

    expect(response.statusCode).toBe(422);
  });

  it.each([{}, { lrclibId: "77" }, { lrclibId: 0 }, { lrclibId: 1.5 }])(
    "corpo inválido %j → 400",
    async (body) => {
      const response = await create(body);

      expect(response.statusCode).toBe(400);
      expect(lrclibClient.getById).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/songs/:id", () => {
  it("devolve o SongDto sem referenceTrack", async () => {
    vi.mocked(lrclibClient.getById).mockResolvedValue(lrclibTrack);
    const created = await create({ lrclibId: 77 });

    const response = await app.inject({ method: "GET", url: `/api/songs/${created.json().id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(created.json());
    expect(response.json()).not.toHaveProperty("referenceTrack");
  });

  it("id inexistente → 404; id que não é uuid → 400", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/api/songs/019a0000-0000-7000-8000-000000000000",
    });
    const invalid = await app.inject({ method: "GET", url: "/api/songs/abc" });

    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
  });
});
