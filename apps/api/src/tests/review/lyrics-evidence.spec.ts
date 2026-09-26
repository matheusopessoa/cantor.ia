import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { lrclibClient } from "../../clients/lrclib.client.js";
import { WorkerClientError, workerClient } from "../../clients/worker.client.js";
import { prisma } from "../../utils/prisma.js";
import type { SelectedLyrics, TranscriptWord } from "../../utils/validators.js";
import { extraction, melody, seedReadySong, seedSong, SONG_MS, VIDEO_ID, waitForReferenceStatus } from "../helpers/songs.js";
import { forcedFrom } from "../helpers/tracks.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { extract: vi.fn(), extractFromYoutube: vi.fn(), getYtmusicSong: vi.fn(), searchYtmusic: vi.fn() },
  };
});

vi.mock("../../clients/lrclib.client.js", () => ({ lrclibClient: { find: vi.fn() } }));

const SELECTED: SelectedLyrics = { source: "whisper", wer: null, candidates: [{ source: "ytmusic", wer: 0.6 }], lines: melody.lines };
const TRANSCRIPT: TranscriptWord[] = [
  { text: "olá", startMs: 300, endMs: 500, probability: 0.9 },
  { text: "mundo", startMs: 600, endMs: 800, probability: 0.8 },
];
const YTMUSIC_LINES = [{ text: "Olá mundo", startMs: null, endMs: null }];

beforeEach(() => {
  vi.mocked(workerClient.getYtmusicSong).mockReset().mockResolvedValue({
    videoId: VIDEO_ID,
    title: "Música",
    artist: "Artista",
    album: null,
    durationS: SONG_MS / 1000,
    lyrics: { status: "plain", source: "Musixmatch", lines: YTMUSIC_LINES },
  });
  vi.mocked(workerClient.extractFromYoutube).mockReset();
  vi.mocked(lrclibClient.find).mockReset().mockResolvedValue([]);
});

describe("evidência da letra (sdd-012)", () => {
  it("música nova READY grava a transcrição e as candidatas e sobe a versão da letra", async () => {
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, forcedFrom(melody.lines), SELECTED, TRANSCRIPT));

    const { id } = (await app.inject({ method: "POST", url: "/api/songs", payload: { videoId: VIDEO_ID } })).json();
    const stored = await waitForReferenceStatus(id, "READY");

    expect(stored.lyricsEvidence).toEqual({
      transcript: TRANSCRIPT,
      candidates: [{ source: "ytmusic", lines: [{ text: "Olá mundo", startMs: null }] }],
    });
    expect(stored.lyricsRevision).toBe(1);
    // A evidência nunca sai no SongDto.
    const dto = (await app.inject({ method: "GET", url: `/api/songs/${id}` })).json();
    expect(dto).not.toHaveProperty("lyricsEvidence");
    expect(dto).not.toHaveProperty("lyricsRevision");
  });

  it("worker sem transcrição (Whisper falhou) → evidência com transcript vazio", async () => {
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track, null, SELECTED, null));

    const { id } = (await app.inject({ method: "POST", url: "/api/songs", payload: { videoId: VIDEO_ID } })).json();
    const stored = await waitForReferenceStatus(id, "READY");

    expect(stored.lyricsEvidence).toMatchObject({ transcript: [] });
  });

  it("música antiga READY não ganha evidência, mas a versão da letra sobe (a letra alinhada mudou)", async () => {
    const song = await seedSong({ lyricsRevision: 3 });
    vi.mocked(workerClient.extractFromYoutube).mockResolvedValue(extraction(melody.track));

    await app.inject({ method: "POST", url: `/api/songs/${song.id}/reference/youtube`, payload: { url: `https://youtu.be/${VIDEO_ID}` } });
    const stored = await waitForReferenceStatus(song.id, "READY");

    expect(stored.lyricsEvidence).toBeNull();
    expect(stored.lyricsRevision).toBe(4);
  });

  it("redo zera a evidência no claim e ela continua nula em FAILED", async () => {
    const song = await seedReadySong({
      sourceVideoId: VIDEO_ID,
      lrclibId: null,
      lyricsSelection: { source: "whisper", wer: null, candidates: [] },
      lyricsEvidence: { transcript: TRANSCRIPT, candidates: [] },
      lyricsRevision: 2,
    });
    let fail!: () => void;
    vi.mocked(workerClient.extractFromYoutube).mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = () => reject(new WorkerClientError("no_voice", "nenhum frame com voz"));
      }),
    );

    await app.inject({ method: "POST", url: `/api/songs/${song.id}/reference/youtube`, payload: { url: `https://youtu.be/${VIDEO_ID}`, redo: true } });

    const claimed = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(claimed.referenceStatus).toBe("PROCESSING");
    expect(claimed.lyricsEvidence).toBeNull();
    expect(claimed.lyricsRevision).toBe(2);

    fail();
    const failed = await waitForReferenceStatus(song.id, "FAILED");
    expect(failed.lyricsEvidence).toBeNull();
    expect(failed.lyricsRevision).toBe(2);
  });
});
