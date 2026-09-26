import { expect, vi } from "vitest";
import type { WorkerExtraction } from "../../clients/worker.client.js";
import type { Prisma, ReferenceStatus, Song } from "../../generated/prisma/client.js";
import { prisma } from "../../utils/prisma.js";
import type { ForcedAlignment, PitchTrack, SelectedLyrics, TranscriptWord } from "../../utils/validators.js";
import { makeMelody } from "./tracks.js";

export const SONG_MS = 60_000;

/** Melodia sintética usada como referência e como letra nos testes de rotas. */
export const melody = makeMelody(42, SONG_MS);

export const VIDEO_ID = "dQw4w9WgXcQ";

/** Insere uma música direto no banco (sem LRCLIB), com a referência ainda `NONE`. */
export function seedSong(overrides: Partial<Prisma.SongUncheckedCreateInput> = {}): Promise<Song> {
  return prisma.song.create({
    data: {
      lrclibId: 1001,
      artist: "Artista",
      title: "Música",
      album: null,
      durationMs: SONG_MS,
      lyrics: melody.lines,
      ...overrides,
    },
  });
}

/** Diagnóstico de uma letra que já estava em cima da referência, alinhada pelas pausas (sdd-007). */
export const PERFECT_ALIGNMENT = { aligned: true, shiftMs: 0, matchedRatio: 1, method: "onset" };

/**
 * O que `workerClient.extract*` devolve: a curva, opcionalmente o alinhamento forçado (sdd-010)
 * e, numa música nova, a letra escolhida (sdd-011) com a transcrição (sdd-012).
 */
export function extraction(
  track: PitchTrack,
  alignment: ForcedAlignment | null = null,
  lyrics: SelectedLyrics | null = null,
  transcript: TranscriptWord[] | null = null,
): WorkerExtraction {
  return { track, alignment, lyrics, transcript };
}

/** A letra de uma música antiga, como vai ao worker (sdd-010: só alinhar). */
export const KNOWN_LYRICS = { kind: "known", lines: melody.lines } as const;

/**
 * Música com referência pronta (vinda do YouTube) e letra alinhada a ela, como o `markReady`
 * grava desde a sdd-007. Para simular uma música anterior à sdd-007, passe
 * `alignedLyrics: Prisma.DbNull, lyricsAlignment: Prisma.DbNull`.
 */
export function seedReadySong(overrides: Partial<Prisma.SongUncheckedCreateInput> = {}): Promise<Song> {
  return seedSong({
    referenceStatus: "READY",
    referenceTrack: melody.track,
    referenceAudioMs: SONG_MS,
    youtubeVideoId: VIDEO_ID,
    referenceUpdatedAt: new Date(),
    alignedLyrics: melody.lines,
    lyricsAlignment: PERFECT_ALIGNMENT,
    ...overrides,
  });
}

const BOUNDARY = "----cantorTestBoundary";

/**
 * Corpo multipart com um único arquivo, para `app.inject`. Os `fields` de texto vêm ANTES do
 * arquivo, como o web manda (é a única ordem em que o controller os enxerga).
 */
export function multipartFile(content: Buffer, filename = "musica.mp3", field = "file", fields: Record<string, string> = {}) {
  const textParts = Object.entries(fields).map(
    ([name, value]) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  const head = Buffer.from(
    textParts.join("") +
      `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: audio/mpeg\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);

  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

const statusSelect = {
  referenceStatus: true,
  referenceError: true,
  referenceAudioMs: true,
  referenceTrack: true,
  youtubeVideoId: true,
  alignedLyrics: true,
  lyricsAlignment: true,
  lyricsSelection: true,
  lyricsEvidence: true,
  lyricsRevision: true,
} as const;

/** Espera o processamento em background chegar ao `status` e devolve o estado gravado. */
export function waitForReferenceStatus(id: string, status: ReferenceStatus) {
  return vi.waitFor(
    async () => {
      const song = await prisma.song.findUniqueOrThrow({ where: { id }, select: statusSelect });
      expect(song.referenceStatus).toBe(status);
      return song;
    },
    { timeout: 3_000, interval: 20 },
  );
}
