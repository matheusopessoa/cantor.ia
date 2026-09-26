import { lrclibClient, type LrclibTrack } from "../clients/lrclib.client.js";
import { WorkerClientError, workerClient, type WorkerAudio } from "../clients/worker.client.js";
import { env } from "../config/env.js";
import { Prisma, type ReferenceErrorCode, type ReferenceStatus } from "../generated/prisma/client.js";
import { songRepository, type AlignmentData, type SongSummary } from "../repositories/song.repository.js";
import {
  AudioProviderUnavailableError,
  ReferenceAlreadyProcessingError,
  ReferenceAlreadyReadyError,
  ReferenceNotReadyError,
  SongAudioUnavailableError,
  SongNotFoundError,
  SongWithoutSyncedLyricsError,
} from "../utils/errors.js";
import { parseLrc } from "../utils/lrc.js";
import type { LyricLine, LyricsAlignment, PitchTrack } from "../utils/validators.js";
import { alignmentService, type AlignmentResult } from "./alignment.service.js";

/** Máximo de resultados da busca. */
export const SEARCH_LIMIT = 20;

/** Áudio com duração diferente da letra em mais que isto → `DURATION_MISMATCH` (regra 7). */
export const DURATION_TOLERANCE_MS = 10_000;

export interface SongSearchItem {
  lrclibId: number;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  /** Preenchidos quando a música já foi cadastrada. */
  songId: string | null;
  referenceStatus: ReferenceStatus | null;
  /** Miniatura na lista (vem na mesma query). */
  youtubeVideoId: string | null;
}

/** Nunca inclui `referenceTrack`: ele só sai em `GET /:id/reference`. */
export interface SongDto {
  id: string;
  lrclibId: number;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  /** Letra do LRCLIB, como veio. */
  lyrics: LyricLine[];
  referenceStatus: ReferenceStatus;
  referenceError: ReferenceErrorCode | null;
  referenceAudioMs: number | null;
  youtubeVideoId: string | null;
  /**
   * Letra alinhada ao áudio da referência (sdd-007). Nulo enquanto não `READY` ou quando o
   * alinhamento não bateu: consumidores usam `alignedLyrics ?? lyrics`.
   */
  alignedLyrics: LyricLine[] | null;
  /** Diagnóstico do alinhamento; nulo enquanto não `READY`. */
  lyricsAlignment: LyricsAlignment | null;
}

export interface CreateSongResult {
  song: SongDto;
  /** `true` na primeira chamada (201); `false` quando já existia (200). */
  created: boolean;
}

export interface ReferenceStarted {
  status: ReferenceStatus;
}

export interface YoutubeReferenceStarted extends ReferenceStarted {
  youtubeVideoId: string;
}

function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

function toDto(song: SongSummary): SongDto {
  return {
    id: song.id,
    lrclibId: song.lrclibId,
    artist: song.artist,
    title: song.title,
    album: song.album,
    durationMs: song.durationMs,
    lyrics: song.lyrics as LyricLine[],
    referenceStatus: song.referenceStatus,
    referenceError: song.referenceError,
    referenceAudioMs: song.referenceAudioMs,
    youtubeVideoId: song.youtubeVideoId,
    alignedLyrics: song.alignedLyrics as LyricLine[] | null,
    lyricsAlignment: song.lyricsAlignment as LyricsAlignment | null,
  };
}

/** Só o diagnóstico do alinhamento (sem as linhas), como sai no `SongDto`. */
function toDiagnostic({ aligned, shiftMs, matchedRatio }: AlignmentResult): LyricsAlignment {
  return { aligned, shiftMs, matchedRatio };
}

/** O que vai para o banco a partir do resultado do alinhamento. */
function toAlignmentData(alignment: AlignmentResult): AlignmentData {
  return {
    alignedLyrics: alignment.lines ?? Prisma.DbNull,
    lyricsAlignment: toDiagnostic(alignment),
  };
}

function toSearchItem(track: LrclibTrack, song: { id: string; referenceStatus: ReferenceStatus; youtubeVideoId: string | null } | undefined): SongSearchItem {
  return {
    lrclibId: track.id,
    artist: track.artistName,
    title: track.trackName,
    album: track.albumName,
    durationMs: toMs(track.duration),
    songId: song?.id ?? null,
    referenceStatus: song?.referenceStatus ?? null,
    youtubeVideoId: song?.youtubeVideoId ?? null,
  };
}

/**
 * Tradução dos códigos do worker (`WorkerClientError.code`) para `ReferenceErrorCode`
 * (sdd-003 §4). Divergência de duração (`DURATION_MISMATCH`) é decidida aqui na API.
 */
export function toReferenceErrorCode(error: unknown): ReferenceErrorCode {
  const code = error instanceof WorkerClientError ? error.code : "internal";

  switch (code) {
    case "video_unavailable":
      return "VIDEO_UNAVAILABLE";
    case "too_long":
      return "TOO_LONG";
    case "no_voice":
      return "NO_VOICE";
    case "download_failed":
    case "timeout":
      return "DOWNLOAD_FAILED";
    case "invalid_audio":
    case "too_large":
      return "INVALID_AUDIO";
    default:
      return "INTERNAL";
  }
}

/**
 * Reserva a música para processamento (regras 4, 5 e 6). Quando o claim falha, relê o
 * status para responder o 409 certo.
 */
async function claim(id: string, youtubeVideoId: string | null): Promise<SongSummary> {
  const song = await songRepository.findById(id);
  if (!song) throw new SongNotFoundError(id);

  const claimed = await songRepository.claimForProcessing(id, youtubeVideoId);
  if (claimed) return song;

  const current = await songRepository.findById(id);
  if (current?.referenceStatus === "READY") throw new ReferenceAlreadyReadyError();
  throw new ReferenceAlreadyProcessingError();
}

/**
 * Processamento em background (a rota já respondeu 202). Todo desfecho termina gravado na
 * música: `READY` com a curva ou `FAILED` com um `ReferenceErrorCode`. Nunca rejeita.
 */
async function runReference(song: SongSummary, extract: () => Promise<PitchTrack>): Promise<void> {
  try {
    const track = await extract();

    if (Math.abs(track.durationMs - song.durationMs) > DURATION_TOLERANCE_MS) {
      await songRepository.markFailed(song.id, {
        referenceError: "DURATION_MISMATCH",
        referenceAudioMs: track.durationMs,
      });
      return;
    }

    // A letra é alinhada ao mesmo áudio de onde saiu a curva (sdd-007): sem query extra.
    const alignment = alignmentService.align(song.lyrics as LyricLine[], track);

    await songRepository.markReady(song.id, {
      referenceTrack: track,
      referenceAudioMs: track.durationMs,
      ...toAlignmentData(alignment),
    });
  } catch (error) {
    // O `message` do worker é só para log (sdd-001 §4): o usuário vê o código.
    if (env.NODE_ENV !== "test") {
      console.error(`[song.service] reference for song ${song.id} failed:`, error);
    }

    try {
      await songRepository.markFailed(song.id, {
        referenceError: toReferenceErrorCode(error),
        referenceAudioMs: null,
      });
    } catch (dbError) {
      console.error(`[song.service] could not mark song ${song.id} as FAILED:`, dbError);
    }
  }
}

export const songService = {
  /** Busca no LRCLIB, só com letra sincronizada (regra 1), anexando o estado local em 1 query. */
  async search(q: string): Promise<SongSearchItem[]> {
    const tracks = (await lrclibClient.search(q))
      .filter((track) => track.syncedLyrics !== null)
      .slice(0, SEARCH_LIMIT);

    const known = await songRepository.findByLrclibIds(tracks.map((track) => track.id));
    const byLrclibId = new Map(known.map((song) => [song.lrclibId, song]));

    return tracks.map((track) => toSearchItem(track, byLrclibId.get(track.id)));
  },

  /** Cadastro idempotente por `lrclibId` (regra 2). */
  async create(lrclibId: number): Promise<CreateSongResult> {
    const existing = await songRepository.findByLrclibId(lrclibId);
    if (existing) return { song: toDto(existing), created: false };

    const track = await lrclibClient.getById(lrclibId);
    if (!track) throw new SongNotFoundError(lrclibId);

    const lyrics = track.syncedLyrics ? parseLrc(track.syncedLyrics) : [];
    if (lyrics.length === 0) throw new SongWithoutSyncedLyricsError(lrclibId);

    const song = await songRepository.upsertByLrclibId({
      lrclibId,
      artist: track.artistName,
      title: track.trackName,
      album: track.albumName,
      durationMs: toMs(track.duration),
      lyrics,
    });

    return { song: toDto(song), created: true };
  },

  /**
   * Música `READY` anterior à sdd-007 (sem `lyricsAlignment`) é alinhada e gravada na primeira
   * leitura (regra 9): 1 leitura com `referenceTrack` + 1 escrita, uma vez por música.
   */
  async getById(id: string): Promise<SongDto> {
    const song = await songRepository.findById(id);
    if (!song) throw new SongNotFoundError(id);

    if (song.referenceStatus === "READY" && song.lyricsAlignment === null) {
      const full = await songRepository.findWithReference(id);
      if (full?.referenceStatus === "READY" && full.referenceTrack !== null) {
        const alignment = alignmentService.align(full.lyrics as LyricLine[], full.referenceTrack as PitchTrack);
        await songRepository.saveAlignment(id, toAlignmentData(alignment));
        return toDto({ ...song, alignedLyrics: alignment.lines, lyricsAlignment: toDiagnostic(alignment) });
      }
    }

    return toDto(song);
  },

  async getReference(id: string): Promise<PitchTrack> {
    const song = await songRepository.findWithReference(id);
    if (!song) throw new SongNotFoundError(id);
    if (song.referenceStatus !== "READY" || song.referenceTrack === null) {
      throw new ReferenceNotReadyError();
    }
    return song.referenceTrack as PitchTrack;
  },

  /**
   * Referência a partir de um arquivo enviado. Responde antes de chamar o worker; o buffer
   * só vive na chamada (regra 3). O claim zera o `youtubeVideoId`.
   */
  async startReference(id: string, audio: Buffer, filename: string): Promise<ReferenceStarted> {
    const song = await claim(id, null);

    void runReference(song, () => workerClient.extract(audio, filename));

    return { status: "PROCESSING" };
  },

  /** Referência a partir do YouTube. Só o `videoId` chega aqui (regra 11). */
  async startReferenceFromYoutube(id: string, videoId: string): Promise<YoutubeReferenceStarted> {
    const song = await claim(id, videoId);

    void runReference(song, () => workerClient.extractFromYoutube(videoId));

    return { status: "PROCESSING", youtubeVideoId: videoId };
  },

  /** Áudio para tocar: baixado do YouTube a cada chamada e repassado em streaming (regra 13). */
  async getAudio(id: string): Promise<WorkerAudio> {
    const song = await songRepository.findById(id);
    if (!song) throw new SongNotFoundError(id);
    if (song.referenceStatus !== "READY" || song.youtubeVideoId === null) {
      throw new SongAudioUnavailableError();
    }

    try {
      return await workerClient.fetchYoutubeAudio(song.youtubeVideoId);
    } catch {
      throw new AudioProviderUnavailableError();
    }
  },
};
