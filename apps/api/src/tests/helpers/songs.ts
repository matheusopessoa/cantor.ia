import { expect, vi } from "vitest";
import type { Prisma, ReferenceStatus, Song } from "../../generated/prisma/client.js";
import { prisma } from "../../utils/prisma.js";
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

/** Música com referência pronta (vinda do YouTube). */
export function seedReadySong(overrides: Partial<Prisma.SongUncheckedCreateInput> = {}): Promise<Song> {
  return seedSong({
    referenceStatus: "READY",
    referenceTrack: melody.track,
    referenceAudioMs: SONG_MS,
    youtubeVideoId: VIDEO_ID,
    referenceUpdatedAt: new Date(),
    ...overrides,
  });
}

const BOUNDARY = "----cantorTestBoundary";

/** Corpo multipart com um único arquivo, para `app.inject`. */
export function multipartFile(content: Buffer, filename = "musica.mp3", field = "file") {
  const head = Buffer.from(
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
