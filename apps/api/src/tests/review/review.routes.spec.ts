import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../app.js";
import { WorkerClientError, workerClient } from "../../clients/worker.client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { REVIEW_CONFIG } from "../../services/lyrics-review.service.js";
import { prisma } from "../../utils/prisma.js";
import type { LyricLine, LyricsEvidence } from "../../utils/validators.js";
import { melody, seedReadySong, seedSong, SONG_MS, VIDEO_ID } from "../helpers/songs.js";
import { forcedFrom } from "../helpers/tracks.js";

vi.mock("../../clients/worker.client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../clients/worker.client.js")>();
  return {
    ...original,
    workerClient: { alignFromYoutube: vi.fn(), extract: vi.fn(), extractFromYoutube: vi.fn() },
  };
});

const AUTH = { authorization: "Bearer test-lyrics-review-secret-only-for-the-test-suite" };
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

function get(url: string) {
  return app.inject({ method: "GET", url, headers: AUTH });
}
function post(url: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url, headers: AUTH, payload });
}
function checkFix(id: string, lines: string[]) {
  return post(`/api/review/songs/${id}/check`, { lines });
}
function applyFix(id: string, checkId: string) {
  return post(`/api/review/songs/${id}/apply`, { checkId });
}

/** Alinha "de verdade" o que recebe: score 0,6 na letra atual, 0,9 na proposta, cada verso na sua dica. */
function alignBoth(scoreBefore = 0.6, scoreAfter = 0.9) {
  vi.mocked(workerClient.alignFromYoutube).mockImplementation(async (_videoId, current: LyricLine[], proposed: LyricLine[]) => ({
    durationMs: SONG_MS,
    current: forcedFrom(current, { score: scoreBefore }),
    proposed: forcedFrom(proposed, { score: scoreAfter }),
  }));
}

const EVIDENCE: LyricsEvidence = {
  transcript: [
    { text: "olá", startMs: 300, endMs: 500, probability: 0.9 },
    { text: "mundo", startMs: 600, endMs: 800, probability: 0.8 },
    { text: "tudo", startMs: 2_500, endMs: 2_700, probability: 0.7 },
    { text: "bem", startMs: 2_800, endMs: 3_000, probability: 0.95 },
  ],
  candidates: [{ source: "ytmusic", lines: [{ text: "Olá mundo", startMs: null }, { text: "Tudo bem", startMs: null }] }],
};

const texts = melody.lines.map((line) => line.text);

beforeEach(() => {
  vi.mocked(workerClient.alignFromYoutube).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/review/songs", () => {
  it("lista só as READY: whisper primeiro, depois menor encaixe, depois mais antigas; respeita o limit", async () => {
    const old = await seedReadySong({ lrclibId: 1, title: "antiga", lyricsAlignment: { aligned: true, shiftMs: 0, matchedRatio: 0.9, method: "forced" } });
    const whisperOk = await seedReadySong({ lrclibId: 2, title: "whisper 0.7", lyricsSelection: { source: "whisper", wer: null, candidates: [] }, lyricsAlignment: { aligned: true, shiftMs: 0, matchedRatio: 0.7, method: "forced" } });
    const site = await seedReadySong({ lrclibId: 3, title: "site 0.5", lyricsSelection: { source: "ytmusic", wer: 0.1, candidates: [{ source: "ytmusic", wer: 0.1 }] }, lyricsAlignment: { aligned: true, shiftMs: 0, matchedRatio: 0.5, method: "forced" } });
    const whisperBad = await seedReadySong({ lrclibId: 4, title: "whisper 0.3", lyricsSelection: { source: "whisper", wer: null, candidates: [], reviewedAt: "2026-09-26T10:00:00.000Z" }, lyricsAlignment: { aligned: false, shiftMs: 0, matchedRatio: 0.3, method: "forced" } });
    await seedSong({ lrclibId: 5, title: "processando", referenceStatus: "PROCESSING" });

    const response = await get("/api/review/songs");

    expect(response.statusCode).toBe(200);
    expect(response.json().map((song: { id: string }) => song.id)).toEqual([whisperBad.id, whisperOk.id, site.id, old.id]);
    expect(response.json()[0]).toEqual({
      id: whisperBad.id,
      artist: "Artista",
      title: "whisper 0.3",
      lyricsSource: "whisper",
      matchedRatio: 0.3,
      lines: melody.lines.length,
      reviewedAt: "2026-09-26T10:00:00.000Z",
    });
    expect(response.json()[3]).toMatchObject({ lyricsSource: null, matchedRatio: 0.9, reviewedAt: null });

    const limited = await get("/api/review/songs?limit=2");
    expect(limited.json().map((song: { id: string }) => song.id)).toEqual([whisperBad.id, whisperOk.id]);
  });

  it("limit inválido → 400", async () => {
    expect((await get("/api/review/songs?limit=0")).statusCode).toBe(400);
    expect((await get("/api/review/songs?limit=51")).statusCode).toBe(400);
  });
});

describe("GET /api/review/songs/:id", () => {
  it("devolve a letra em uso com a transcrição em versos e as candidatas", async () => {
    const song = await seedReadySong({
      sourceVideoId: VIDEO_ID,
      lrclibId: null,
      lyricsSelection: { source: "whisper", wer: null, candidates: [] },
      lyricsEvidence: EVIDENCE,
      lyricsRevision: 2,
    });

    const response = await get(`/api/review/songs/${song.id}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: song.id,
      artist: "Artista",
      title: "Música",
      youtubeVideoId: VIDEO_ID,
      lyricsRevision: 2,
      selection: { source: "whisper", wer: null, candidates: [] },
      lines: melody.lines.map((line, index) => ({ index, text: line.text, startMs: line.startMs })),
      transcriptLines: [
        { text: "olá mundo", startMs: 300 },
        { text: "tudo bem", startMs: 2_500 },
      ],
      candidates: [{ source: "ytmusic", lines: ["Olá mundo", "Tudo bem"] }],
    });
  });

  it("usa a letra alinhada quando existe e a original quando não", async () => {
    const shifted = melody.lines.map((line) => ({ ...line, startMs: line.startMs + 500 }));
    const aligned = await seedReadySong({ alignedLyrics: shifted });
    expect((await get(`/api/review/songs/${aligned.id}`)).json().lines[0].startMs).toBe(shifted[0]!.startMs);

    const notAligned = await seedReadySong({ lrclibId: 2, alignedLyrics: Prisma.DbNull });
    expect((await get(`/api/review/songs/${notAligned.id}`)).json().lines[0].startMs).toBe(melody.lines[0]!.startMs);
  });

  it("música antiga (sem evidência) → transcriptLines e candidates nulos", async () => {
    const song = await seedReadySong();

    const body = (await get(`/api/review/songs/${song.id}`)).json();

    expect(body.selection).toBeNull();
    expect(body.transcriptLines).toBeNull();
    expect(body.candidates).toBeNull();
    expect(body.lyricsRevision).toBe(0);
  });

  it("música inexistente → 404", async () => {
    expect((await get(`/api/review/songs/${UNKNOWN_ID}`)).statusCode).toBe(404);
  });
});

describe("POST /api/review/songs/:id/check", () => {
  it("alinha a letra atual e a proposta no áudio e devolve o antes/depois por verso, sem gravar", async () => {
    const song = await seedReadySong({ lyricsRevision: 1 });
    alignBoth();
    const proposed = [...texts];
    proposed[1] = `${texts[1]} corrigida`;
    proposed.splice(3, 0, "verso novo");
    const removedText = proposed.pop()!;

    const response = await checkFix(song.id, proposed);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.checkId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + REVIEW_CONFIG.checkTtlMs - 5_000);
    expect(body.lines).toHaveLength(proposed.length);
    expect(body.lines[0]).toEqual({ index: 0, text: texts[0], startMs: melody.lines[0]!.startMs, score: 0.9, change: "same", before: { text: texts[0], score: 0.6 } });
    expect(body.lines[1]).toMatchObject({ text: proposed[1], change: "edited", before: { text: texts[1], score: 0.6 }, score: 0.9 });
    expect(body.lines[3]).toEqual({ index: 3, text: "verso novo", startMs: melody.lines[2]!.startMs + REVIEW_CONFIG.lineHintStepMs, score: 0.9, change: "added" });
    expect(body.removed).toEqual([{ text: removedText, score: 0.6 }]);
    expect(body.summary).toEqual({ edited: 1, added: 1, removed: 1, meanScoreBefore: 0.6, meanScoreAfter: 0.9 });

    // Só o videoId, a letra em uso e a proposta com as dicas vão ao worker.
    const [videoId, current, sent] = vi.mocked(workerClient.alignFromYoutube).mock.calls[0]!;
    expect(videoId).toBe(VIDEO_ID);
    expect(current).toEqual(melody.lines);
    expect(sent.map((line: LyricLine) => line.text)).toEqual(proposed);

    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.lyrics).toEqual(melody.lines);
    expect(stored.lyricsRevision).toBe(1);
  });

  it("verso sem texto alinhável fica com score nulo e não entra na média", async () => {
    const song = await seedReadySong();
    alignBoth();

    const body = (await checkFix(song.id, [...texts, ""])).json();

    expect(body.lines.at(-1)).toMatchObject({ text: "", change: "added", score: null });
    expect(body.summary.meanScoreAfter).toBe(0.9);
  });

  it("worker sem alinhamento (null) → scores nulos, sem erro", async () => {
    const song = await seedReadySong();
    vi.mocked(workerClient.alignFromYoutube).mockResolvedValue({ durationMs: SONG_MS, current: null, proposed: null });

    const body = (await checkFix(song.id, texts)).json();

    expect(body.lines.every((line: { score: number | null }) => line.score === null)).toBe(true);
    expect(body.summary).toMatchObject({ meanScoreBefore: null, meanScoreAfter: null });
  });

  it("referência por upload (sem vídeo) → 409 REVIEW_NEEDS_VIDEO, sem chamar o worker", async () => {
    const song = await seedReadySong({ youtubeVideoId: null });

    const response = await checkFix(song.id, texts);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "REVIEW_NEEDS_VIDEO" });
    expect(workerClient.alignFromYoutube).not.toHaveBeenCalled();
  });

  it.each(["NONE", "PROCESSING", "FAILED"] as const)("referência %s → 409 REFERENCE_NOT_READY", async (status) => {
    const song = await seedSong({ referenceStatus: status, youtubeVideoId: VIDEO_ID });

    const response = await checkFix(song.id, texts);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "REFERENCE_NOT_READY" });
  });

  it("worker fora → 502 ALIGN_FAILED", async () => {
    const song = await seedReadySong();
    vi.mocked(workerClient.alignFromYoutube).mockRejectedValue(new WorkerClientError("unreachable", "fora"));

    const response = await checkFix(song.id, texts);

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "ALIGN_FAILED" });
  });

  it.each([{}, { lines: [] }, { lines: "texto" }, { lines: [1] }, { lines: ["x".repeat(301)] }])("corpo inválido %j → 400", async (payload) => {
    const song = await seedReadySong();

    expect((await post(`/api/review/songs/${song.id}/check`, payload)).statusCode).toBe(400);
  });

  it("música inexistente → 404", async () => {
    expect((await checkFix(UNKNOWN_ID, texts)).statusCode).toBe(404);
  });
});

describe("POST /api/review/songs/:id/apply", () => {
  it("grava a proposta conferida: letra, alinhamento, reviewedAt e versão nova; o checkId é consumido", async () => {
    const song = await seedReadySong({
      sourceVideoId: VIDEO_ID,
      lrclibId: null,
      lyricsSelection: { source: "whisper", wer: null, candidates: [] },
      lyricsRevision: 1,
    });
    alignBoth();
    const proposed = [...texts];
    proposed[0] = "Primeiro verso corrigido";
    const { checkId } = (await checkFix(song.id, proposed)).json();

    const response = await applyFix(song.id, checkId);

    expect(response.statusCode).toBe(200);
    const dto = response.json();
    expect(dto.id).toBe(song.id);
    expect(dto.lyrics.map((line: LyricLine) => line.text)).toEqual(proposed);
    expect(dto.lyrics[0].startMs).toBe(melody.lines[0]!.startMs);
    expect(dto.alignedLyrics.map((line: LyricLine) => line.text)).toEqual(proposed);
    expect(dto.lyricsAlignment).toMatchObject({ aligned: true, matchedRatio: 1, method: "forced" });
    expect(dto.lyricsSelection).toEqual({ source: "whisper", wer: null, candidates: [], reviewedAt: expect.any(String) });
    expect(dto).not.toHaveProperty("lyricsEvidence");

    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.lyricsRevision).toBe(2);
    expect(stored.referenceStatus).toBe("READY");
    expect(stored.referenceTrack).toEqual(melody.track);

    const again = await applyFix(song.id, checkId);
    expect(again.statusCode).toBe(410);
    expect(again.json()).toMatchObject({ code: "REVIEW_CHECK_EXPIRED" });
  });

  it("música antiga (sem lyricsSelection) ganha { source: lrclib, reviewedAt }", async () => {
    const song = await seedReadySong();
    alignBoth();
    const { checkId } = (await checkFix(song.id, texts)).json();

    const dto = (await applyFix(song.id, checkId)).json();

    expect(dto.lyricsSelection).toEqual({ source: "lrclib", wer: null, candidates: [], reviewedAt: expect.any(String) });
  });

  it("proposta com scores baixos → alinhamento recusado, letra gravada com as dicas de tempo", async () => {
    const song = await seedReadySong();
    alignBoth(0.6, 0.1);
    const { checkId } = (await checkFix(song.id, texts)).json();

    const dto = (await applyFix(song.id, checkId)).json();

    expect(dto.lyricsAlignment).toMatchObject({ aligned: false, method: "forced" });
    expect(dto.alignedLyrics).toBeNull();
    expect(dto.lyrics).toEqual(melody.lines);
  });

  it("checkId desconhecido ou de outra música → 410", async () => {
    const song = await seedReadySong();
    const other = await seedReadySong({ lrclibId: 2 });
    alignBoth();
    const { checkId } = (await checkFix(other.id, texts)).json();

    expect((await applyFix(song.id, UNKNOWN_ID)).statusCode).toBe(410);
    expect((await applyFix(song.id, checkId)).statusCode).toBe(410);
    expect((await applyFix(other.id, checkId)).statusCode).toBe(200);
  });

  it("conferência com mais de 30 min → 410", async () => {
    const song = await seedReadySong();
    alignBoth();
    const { checkId } = (await checkFix(song.id, texts)).json();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + REVIEW_CONFIG.checkTtlMs + 1_000);

    const response = await applyFix(song.id, checkId);

    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ code: "REVIEW_CHECK_EXPIRED" });
  });

  it("redo (ou outra revisão) entre a conferência e a aplicação → 409 LYRICS_CHANGED, sem gravar", async () => {
    const song = await seedReadySong({ lyricsRevision: 1 });
    alignBoth();
    const proposed = [...texts];
    proposed[0] = "mudou";
    const { checkId } = (await checkFix(song.id, proposed)).json();
    await prisma.song.update({ where: { id: song.id }, data: { lyricsRevision: 2 } });

    const response = await applyFix(song.id, checkId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "LYRICS_CHANGED" });
    const stored = await prisma.song.findUniqueOrThrow({ where: { id: song.id } });
    expect(stored.lyrics).toEqual(melody.lines);
    expect(stored.lyricsRevision).toBe(2);
  });

  it("referência que saiu de READY no meio → 409 REFERENCE_NOT_READY", async () => {
    const song = await seedReadySong();
    alignBoth();
    const { checkId } = (await checkFix(song.id, texts)).json();
    await prisma.song.update({ where: { id: song.id }, data: { referenceStatus: "PROCESSING" } });

    const response = await applyFix(song.id, checkId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "REFERENCE_NOT_READY" });
  });

  it("corpo sem checkId válido → 400", async () => {
    const song = await seedReadySong();

    expect((await post(`/api/review/songs/${song.id}/apply`, {})).statusCode).toBe(400);
    expect((await post(`/api/review/songs/${song.id}/apply`, { checkId: "abc" })).statusCode).toBe(400);
  });
});
