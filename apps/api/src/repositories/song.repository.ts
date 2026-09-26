import { Prisma, type ReferenceErrorCode, type Song } from "../generated/prisma/client.js";
import { prisma } from "../utils/prisma.js";

/** `PROCESSING` há mais deste tempo é tratado como abandonado e aceita novo processamento (regra 6). */
export const PROCESSING_STALE_MS = 15 * 60_000;

/**
 * Campos do `Song` sem o `referenceTrack` (pode passar de 400 KB). É o que vai para o
 * `SongDto` e para as listas; só `findWithReference` carrega o campo.
 */
const songSummarySelect = {
  id: true,
  lrclibId: true,
  artist: true,
  title: true,
  album: true,
  durationMs: true,
  lyrics: true,
  referenceStatus: true,
  referenceError: true,
  referenceAudioMs: true,
  youtubeVideoId: true,
  referenceUpdatedAt: true,
  createdAt: true,
} satisfies Prisma.SongSelect;

export type SongSummary = Prisma.SongGetPayload<{ select: typeof songSummarySelect }>;

/** O mínimo para anexar o estado da música aos resultados da busca no LRCLIB. */
const songLookupSelect = {
  id: true,
  lrclibId: true,
  referenceStatus: true,
  youtubeVideoId: true,
} satisfies Prisma.SongSelect;

export type SongLookup = Prisma.SongGetPayload<{ select: typeof songLookupSelect }>;

export interface CreateSongData {
  lrclibId: number;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  /** `LyricLine[]` */
  lyrics: Prisma.InputJsonValue;
}

export interface MarkReadyData {
  /** `PitchTrack` */
  referenceTrack: Prisma.InputJsonValue;
  referenceAudioMs: number;
}

export interface MarkFailedData {
  referenceError: ReferenceErrorCode;
  referenceAudioMs: number | null;
}

export const songRepository = {
  findById(id: string): Promise<SongSummary | null> {
    return prisma.song.findUnique({ where: { id }, select: songSummarySelect });
  },

  /** Único ponto que carrega o `referenceTrack`. */
  findWithReference(id: string): Promise<Song | null> {
    return prisma.song.findUnique({ where: { id } });
  },

  findByLrclibId(lrclibId: number): Promise<SongSummary | null> {
    return prisma.song.findUnique({ where: { lrclibId }, select: songSummarySelect });
  },

  findByLrclibIds(lrclibIds: number[]): Promise<SongLookup[]> {
    if (lrclibIds.length === 0) return Promise.resolve([]);
    return prisma.song.findMany({ where: { lrclibId: { in: lrclibIds } }, select: songLookupSelect });
  },

  /** Idempotente por `lrclibId`: se já existe, devolve a música sem alterar nada. */
  upsertByLrclibId(data: CreateSongData): Promise<SongSummary> {
    return prisma.song.upsert({
      where: { lrclibId: data.lrclibId },
      create: data,
      update: {},
      select: songSummarySelect,
    });
  },

  /**
   * Transição atômica para `PROCESSING` (regra 4). Só passa se o status for `NONE`/`FAILED`
   * ou um `PROCESSING` abandonado (regra 6). Grava o `youtubeVideoId` já no claim (regra 12).
   * Devolve `false` quando outra requisição ganhou a corrida ou a referência já está pronta.
   */
  async claimForProcessing(id: string, youtubeVideoId: string | null, now = new Date()): Promise<boolean> {
    const staleBefore = new Date(now.getTime() - PROCESSING_STALE_MS);

    const { count } = await prisma.song.updateMany({
      where: {
        id,
        OR: [
          { referenceStatus: { in: ["NONE", "FAILED"] } },
          { referenceStatus: "PROCESSING", referenceUpdatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        referenceStatus: "PROCESSING",
        referenceUpdatedAt: now,
        youtubeVideoId,
        referenceError: null,
        referenceAudioMs: null,
      },
    });

    return count === 1;
  },

  async markReady(id: string, { referenceTrack, referenceAudioMs }: MarkReadyData): Promise<void> {
    await prisma.song.update({
      where: { id },
      data: {
        referenceStatus: "READY",
        referenceTrack,
        referenceAudioMs,
        referenceError: null,
        referenceUpdatedAt: new Date(),
      },
    });
  },

  /** Falha zera o `youtubeVideoId`: só música `READY` serve áudio (regra 12). */
  async markFailed(id: string, { referenceError, referenceAudioMs }: MarkFailedData): Promise<void> {
    await prisma.song.update({
      where: { id },
      data: {
        referenceStatus: "FAILED",
        referenceError,
        referenceAudioMs,
        referenceTrack: Prisma.DbNull,
        youtubeVideoId: null,
        referenceUpdatedAt: new Date(),
      },
    });
  },
};
