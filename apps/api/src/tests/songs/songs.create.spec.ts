import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { lrclibClient, type LrclibTrack } from "../../clients/lrclib.client.js";
import { WorkerClientError, workerClient, type WorkerYtmusicSong } from "../../clients/worker.client.js";
import { LyricsProviderUnavailableError } from "../../utils/errors.js";
import { prisma } from "../../utils/prisma.js";
import type { SelectedLyrics } from "../../utils/validators.js";
import { extraction, melody, SONG_MS, VIDEO_ID, waitForReferenceStatus } from "../helpers/songs.js";
import { forcedFrom } from "../helpers/tracks.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), getYtmusicSong: vi.fn(), searchYtmusic: vi.fn() },
  };
});

vi.mock("../../clients/lrclib.client.js", () => ({ lrclibClient: { find: vi.fn(), search: vi.fn(), getById: vi.fn() } }));

function ytmusicSong(overrides: Partial<WorkerYtmusicSong> = {}): WorkerYtmusicSong {
  return {
    videoId: VIDEO_ID,
    title: "Tanto Faz",
    artist: "Tim Bernardes",
    album: "Recomeçar",
    durationS: SONG_MS / 1000,
    lyrics: { status: "plain", source: "Musixmatch", lines: [{ text: "Tanto faz quem saiu", startMs: null, endMs: null }] },
    ...overrides,
  };
}

function lrclibTrack(overrides: Partial<LrclibTrack> = {}): LrclibTrack {
  return {
    id: 7,
    trackName: "Tanto Faz",
    artistName: "Tim Bernardes",
    albumName: null,
    duration: SONG_MS / 1000,
    syncedLyrics: null,
    plainLyrics: "Tanto faz quem saiu\n\nquem entrou",
    ...overrides,
  };
}

/** O que o worker escolheu: a letra da melodia de teste, vinda do YouTube Music. */
const SELECTED: SelectedLyrics = {
  source: "ytmusic",
  wer: 0.05,
  candidates: [
    { source: "ytmusic", wer: 0.05 },
    { source: "lrclib", wer: 0.4 },
  ],
  lines: melody.lines,
};

function create(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/songs", payload: body });
}

/** Extração que só termina quando o teste manda (para ver o `PROCESSING`). */
function pendingExtraction() {
  let finish!: () => void;
  vi.mocked(workerClient.extractFromYoutube).mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve(extraction(melody.track, forcedFrom(melody.lines), SELECTED));
    }),
  );
  return () => finish();
}

beforeEach(() => {
  vi.mocked(workerClient.getYtmusicSong).mockReset().mockResolvedValue(ytmusicSong());
  vi.mocked(workerClient.extractFromYoutube).mockReset();
  vi.mocked(lrclibClient.find).mockReset().mockResolvedValue([lrclibTrack()]);
  vi.mocked(lrclibClient.getById).mockReset();
});

describe("POST /api/songs (sdd-011: pelo vídeo)", () => {
  it("cadastra pelos metadados do YouTube Music, responde 201 e já está PROCESSING", async () => {
    const finish = pendingExtraction();

    const response = await create({ videoId: VIDEO_ID });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      lrclibId: null,
      sourceVideoId: VIDEO_ID,
      artist: "Tim Bernardes",
      title: "Tanto Faz",
      album: "Recomeçar",
      durationMs: SONG_MS,
      lyrics: [],
      referenceStatus: "PROCESSING",
      referenceError: null,
      referenceAudioMs: null,
      referenceUpdatedAt: expect.any(String),
      youtubeVideoId: VIDEO_ID,
      alignedLyrics: null,
      lyricsAlignment: null,
      lyricsSelection: null,
      stemsKey: null,
    });
    finish();
    await waitForReferenceStatus(response.json().id, "READY");
  });

  it("manda ao worker as candidatas dos dois sites e o prompt com artista e título", async () => {
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, forcedFrom(melody.lines), SELECTED));

    const { id } = (await create({ videoId: VIDEO_ID })).json();
    await waitForReferenceStatus(id, "READY");

    expect(lrclibClient.find).toHaveBeenCalledWith({ artist: "Tim Bernardes", title: "Tanto Faz" });
    expect(workerClient.extractFromYoutube).toHaveBeenCalledWith(VIDEO_ID, {
      kind: "candidates",
      prompt: "Tim Bernardes - Tanto Faz",
      candidates: [
        { source: "ytmusic", lines: [{ text: "Tanto faz quem saiu", startMs: null }] },
        {
          source: "lrclib",
          lines: [
            { text: "Tanto faz quem saiu", startMs: null },
            { text: "quem entrou", startMs: null },
          ],
        },
      ],
    }, { stems: true });
  });

  it("ao terminar grava a letra escolhida, a escolha e a letra alinhada", async () => {
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, forcedFrom(melody.lines), SELECTED));

    const { id } = (await create({ videoId: VIDEO_ID })).json();
    await waitForReferenceStatus(id, "READY");

    const song = (await app.inject({ method: "GET", url: `/api/songs/${id}` })).json();
    expect(song.lyrics).toEqual(melody.lines);
    expect(song.lyricsSelection).toEqual({ source: "ytmusic", wer: 0.05, candidates: SELECTED.candidates });
    expect(song.alignedLyrics).toEqual(melody.lines);
    expect(song.lyricsAlignment).toMatchObject({ aligned: true, method: "forced" });
  });

  it("sem letra de site que combine, a transcrição vira a letra (source whisper)", async () => {
    const whisper: SelectedLyrics = { source: "whisper", wer: null, candidates: [], lines: melody.lines };
    vi.mocked(lrclibClient.find).mockResolvedValue([]);
    vi.mocked(workerClient.getYtmusicSong).mockResolvedValue(ytmusicSong({ lyrics: { status: "none", source: null, lines: [] } }));
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, forcedFrom(melody.lines), whisper));

    const { id } = (await create({ videoId: VIDEO_ID })).json();
    await waitForReferenceStatus(id, "READY");

    expect(vi.mocked(workerClient.extractFromYoutube).mock.calls[0]?.[1]).toMatchObject({ kind: "candidates", candidates: [] });
    const stored = await prisma.song.findUniqueOrThrow({ where: { id } });
    expect(stored.lyricsSelection).toEqual({ source: "whisper", wer: null, candidates: [] });
    expect(stored.lyrics).toEqual(melody.lines);
  });

  it("fonte de letra fora do ar não impede o processamento", async () => {
    vi.mocked(lrclibClient.find).mockRejectedValue(new Error("LRCLIB fora"));
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, null, SELECTED));

    const { id } = (await create({ videoId: VIDEO_ID })).json();
    await waitForReferenceStatus(id, "READY");

    const sent = vi.mocked(workerClient.extractFromYoutube).mock.calls[0]?.[1];
    expect(sent).toMatchObject({ kind: "candidates", candidates: [{ source: "ytmusic" }] });
  });

  it("segunda chamada devolve a mesma música com 200, sem reprocessar nem consultar o YouTube Music", async () => {
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, null, SELECTED));
    const first = (await create({ videoId: VIDEO_ID })).json();
    await waitForReferenceStatus(first.id, "READY");

    const second = await create({ videoId: VIDEO_ID });

    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.id);
    expect(workerClient.getYtmusicSong).toHaveBeenCalledTimes(2); // cadastro + letra da 1ª vez
    expect(workerClient.extractFromYoutube).toHaveBeenCalledTimes(1);
    expect(await prisma.song.count()).toBe(1);
  });

  it("chamadas simultâneas criam 1 música e 1 processamento", async () => {
    const finish = pendingExtraction();

    const responses = await Promise.all([create({ videoId: VIDEO_ID }), create({ videoId: VIDEO_ID })]);

    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
    expect(await prisma.song.count()).toBe(1);
    await vi.waitFor(() => expect(workerClient.extractFromYoutube).toHaveBeenCalledTimes(1));
    finish();
    await waitForReferenceStatus(responses[0]!.json().id, "READY");
    expect(workerClient.extractFromYoutube).toHaveBeenCalledTimes(1);
  });

  it.each([{ videoId: "curto" }, { videoId: "dQw4w9WgXc!" }, { videoId: VIDEO_ID, lrclibId: 77 }, { videoId: VIDEO_ID, extra: true }, {}])(
    "corpo inválido %j → 400",
    async (body) => {
      const response = await create(body);

      expect(response.statusCode).toBe(400);
      expect(workerClient.getYtmusicSong).not.toHaveBeenCalled();
      expect(lrclibClient.getById).not.toHaveBeenCalled();
    },
  );

  it("YouTube Music sem o vídeo (ou fora do ar) → 502 VIDEO_UNAVAILABLE, sem cadastrar", async () => {
    vi.mocked(workerClient.getYtmusicSong).mockRejectedValue(new WorkerClientError("video_unavailable", "não conhece"));

    const response = await create({ videoId: VIDEO_ID });

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("VIDEO_UNAVAILABLE");
    expect(await prisma.song.count()).toBe(0);
  });

  it("vídeo sem duração no YouTube Music → 502, sem cadastrar", async () => {
    vi.mocked(workerClient.getYtmusicSong).mockResolvedValue(ytmusicSong({ durationS: null }));

    const response = await create({ videoId: VIDEO_ID });

    expect(response.statusCode).toBe(502);
    expect(await prisma.song.count()).toBe(0);
  });
});

/** Cadastro pela letra (sdd-015): a faixa do LRCLIB, sem começar a referência (sem Whisper). */
describe("POST /api/songs { lrclibId } (sdd-015: pela letra)", () => {
  const SYNCED = "[00:01.00]Primeira linha\n[00:05.50]Segunda linha";

  beforeEach(() => {
    vi.mocked(lrclibClient.getById).mockResolvedValue(lrclibTrack({ id: 77, syncedLyrics: SYNCED, albumName: "Álbum" }));
  });

  it("cadastra com a letra parseada, responde 201 em NONE e não chama o worker", async () => {
    const response = await create({ lrclibId: 77 });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      lrclibId: 77,
      sourceVideoId: null,
      artist: "Tim Bernardes",
      title: "Tanto Faz",
      album: "Álbum",
      durationMs: SONG_MS,
      lyrics: [
        { text: "Primeira linha", startMs: 1_000 },
        { text: "Segunda linha", startMs: 5_500 },
      ],
      referenceStatus: "NONE",
      youtubeVideoId: null,
      lyricsSelection: null,
      stemsKey: null,
    });
    expect(response.json()).not.toHaveProperty("referenceTrack");
    expect(lrclibClient.getById).toHaveBeenCalledWith(77);
    expect(workerClient.getYtmusicSong).not.toHaveBeenCalled();
    expect(workerClient.extractFromYoutube).not.toHaveBeenCalled();
  });

  it("segunda chamada devolve a mesma música com 200, sem consultar o LRCLIB de novo", async () => {
    const first = await create({ lrclibId: 77 });
    const second = await create({ lrclibId: 77 });

    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(lrclibClient.getById).toHaveBeenCalledTimes(1);
  });

  it("chamadas simultâneas criam 1 música, sem referência", async () => {
    const responses = await Promise.all([create({ lrclibId: 77 }), create({ lrclibId: 77 })]);

    expect(responses.every((r) => r.statusCode === 200 || r.statusCode === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
    expect(await prisma.song.count()).toBe(1);
    expect(workerClient.extractFromYoutube).not.toHaveBeenCalled();
  });

  it("id inexistente no LRCLIB → 404", async () => {
    vi.mocked(lrclibClient.getById).mockResolvedValue(null);

    const response = await create({ lrclibId: 999 });

    expect(response.statusCode).toBe(404);
    expect(await prisma.song.count()).toBe(0);
  });

  it.each([
    ["sem letra sincronizada", null],
    ["sincronizada sem nenhuma tag de tempo", "só texto\nsem tempo"],
  ])("%s → 422 NO_SYNCED_LYRICS, sem cadastrar", async (_, syncedLyrics) => {
    vi.mocked(lrclibClient.getById).mockResolvedValue(lrclibTrack({ id: 77, syncedLyrics }));

    const response = await create({ lrclibId: 77 });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("NO_SYNCED_LYRICS");
    expect(await prisma.song.count()).toBe(0);
  });

  it("LRCLIB fora → 502 LYRICS_UNAVAILABLE", async () => {
    vi.mocked(lrclibClient.getById).mockRejectedValue(new LyricsProviderUnavailableError());

    const response = await create({ lrclibId: 77 });

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("LYRICS_UNAVAILABLE");
  });

  it.each([{ lrclibId: "77" }, { lrclibId: 0 }, { lrclibId: 1.5 }, { lrclibId: -3 }])("corpo inválido %j → 400", async (body) => {
    const response = await create(body);

    expect(response.statusCode).toBe(400);
    expect(lrclibClient.getById).not.toHaveBeenCalled();
  });
});
