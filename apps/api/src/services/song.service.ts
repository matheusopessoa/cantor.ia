import { randomUUID } from "node:crypto";
import { lrclibClient, type LrclibTrack } from "../clients/lrclib.client.js";
import {
  WorkerClientError,
  workerClient,
  type WorkerAudio,
  type WorkerExtraction,
  type WorkerLyricsInput,
  type WorkerStemFiles,
  type WorkerStems,
  type WorkerYtmusicSong,
} from "../clients/worker.client.js";
import { env } from "../config/env.js";
import { Prisma, type ReferenceErrorCode, type ReferenceStatus } from "../generated/prisma/client.js";
import {
  songRepository,
  type AlignmentData,
  type LyricsLookup,
  type SongLookup,
  type SongSummary,
} from "../repositories/song.repository.js";
import { stemsRepository, type StoredStem } from "../repositories/stems.repository.js";
import {
  AudioProviderUnavailableError,
  ReferenceAlreadyProcessingError,
  ReferenceAlreadyReadyError,
  ReferenceNotReadyError,
  SongAudioUnavailableError,
  SongNotFoundError,
  SongWithoutSyncedLyricsError,
  STEMS_AUDIO_REJECTIONS,
  StemsAudioRejectedError,
  StemsNotStoredError,
  StemsUnavailableError,
  VideoMetadataUnavailableError,
  YoutubeSearchUnavailableError,
} from "../utils/errors.js";
import type { LyricLine, LyricsAlignment, LyricsEvidence, LyricsSelection, PitchTrack, StemName } from "../utils/validators.js";
import { parseLrc } from "../utils/lrc.js";
import { alignmentService, type AlignmentResult } from "./alignment.service.js";
import { lyricsSourceService } from "./lyrics-source.service.js";

/** Máximo de resultados da busca. */
export const SEARCH_LIMIT = 20;

/** Áudio com duração diferente da letra em mais que isto → `DURATION_MISMATCH` (regra 7). */
export const DURATION_TOLERANCE_MS = 10_000;

/** Um resultado da busca no YouTube Music (sdd-011): cada resultado já é o vídeo da música. */
export interface SongSearchItem {
  videoId: string;
  artist: string;
  title: string;
  album: string | null;
  /** Nulo quando o YouTube Music não informa. */
  durationMs: number | null;
  /** Preenchidos quando a música já foi cadastrada (por este vídeo, ou uma antiga que usa ele). */
  songId: string | null;
  referenceStatus: ReferenceStatus | null;
}

/**
 * Um resultado da busca pela letra (LRCLIB, sdd-015): só faixas com letra sincronizada. O vídeo
 * vem depois, pela sugestão da preparação (sdd-008).
 */
export interface LyricsSearchItem {
  lrclibId: number;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  /** Preenchidos quando a música já foi cadastrada por este `lrclibId`. */
  songId: string | null;
  referenceStatus: ReferenceStatus | null;
  /** Vídeo da referência, para a miniatura; nulo sem referência pelo YouTube. */
  youtubeVideoId: string | null;
}

/** Nunca inclui `referenceTrack`: ele só sai em `GET /:id/reference`. */
export interface SongDto {
  id: string;
  /** Só nas músicas cadastradas pela busca do LRCLIB (antes da sdd-011). */
  lrclibId: number | null;
  /** Vídeo escolhido na busca (sdd-011); nulo nas músicas antigas. */
  sourceVideoId: string | null;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  /**
   * Música antiga: a letra do LRCLIB, como veio. Música nova: vazia até `READY`; depois, a
   * letra escolhida pelo worker (sdd-011).
   */
  lyrics: LyricLine[];
  referenceStatus: ReferenceStatus;
  referenceError: ReferenceErrorCode | null;
  referenceAudioMs: number | null;
  /**
   * Última mudança de status da referência (ISO 8601); nulo se nunca teve referência. A tela
   * usa para oferecer "Tentar de novo" num `PROCESSING` travado (achado da sdd-011).
   */
  referenceUpdatedAt: string | null;
  youtubeVideoId: string | null;
  /**
   * Letra alinhada ao áudio da referência (sdd-007). Nulo enquanto não `READY` ou quando o
   * alinhamento não bateu: consumidores usam `alignedLyrics ?? lyrics`.
   */
  alignedLyrics: LyricLine[] | null;
  /** Diagnóstico do alinhamento; nulo enquanto não `READY`. */
  lyricsAlignment: LyricsAlignment | null;
  /** De onde veio a letra (sdd-011); nulo nas músicas antigas e até a primeira `READY`. */
  lyricsSelection: LyricsSelection | null;
  /**
   * Chave das trilhas guardadas (voz e instrumental, sdd-016): com ela, o karaokê toca por
   * `GET /:id/stems/{vocals,instrumental}` e o aparelho valida o cache por ela. Nulo sem trilhas
   * (música anterior à sdd-016, não `READY`, ou gravar falhou): o web usa o fluxo da sdd-013.
   */
  stemsKey: string | null;
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

export interface ReferenceOptions {
  /** Reprocessa uma referência `READY` (melodia e letra, sdd-010). Padrão `false`: `READY` → 409. */
  redo?: boolean;
}

function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/** `SongSummary` → `SongDto`. Exportado para a revisão da letra devolver a música atualizada (sdd-012). */
export function toSongDto(song: SongSummary): SongDto {
  return {
    id: song.id,
    lrclibId: song.lrclibId,
    sourceVideoId: song.sourceVideoId,
    artist: song.artist,
    title: song.title,
    album: song.album,
    durationMs: song.durationMs,
    lyrics: song.lyrics as LyricLine[],
    referenceStatus: song.referenceStatus,
    referenceError: song.referenceError,
    referenceAudioMs: song.referenceAudioMs,
    referenceUpdatedAt: song.referenceUpdatedAt?.toISOString() ?? null,
    youtubeVideoId: song.youtubeVideoId,
    alignedLyrics: song.alignedLyrics as LyricLine[] | null,
    lyricsAlignment: song.lyricsAlignment as LyricsAlignment | null,
    lyricsSelection: song.lyricsSelection as LyricsSelection | null,
    stemsKey: song.stemsKey,
  };
}

/** Só o diagnóstico do alinhamento (sem as linhas), como sai no `SongDto`. */
function toDiagnostic({ aligned, shiftMs, matchedRatio, method }: AlignmentResult): LyricsAlignment {
  return { aligned, shiftMs, matchedRatio, method };
}

/** O que vai para o banco a partir do resultado do alinhamento. */
function toAlignmentData(alignment: AlignmentResult): AlignmentData {
  return {
    alignedLyrics: alignment.lines ?? Prisma.DbNull,
    lyricsAlignment: toDiagnostic(alignment),
  };
}

function toSearchItem(result: WorkerYtmusicSong, song: SongLookup | undefined): SongSearchItem {
  return {
    videoId: result.videoId,
    artist: result.artist,
    title: result.title,
    album: result.album,
    durationMs: result.durationS === null ? null : toMs(result.durationS),
    songId: song?.id ?? null,
    referenceStatus: song?.referenceStatus ?? null,
  };
}

function toLyricsSearchItem(track: LrclibTrack, song: LyricsLookup | undefined): LyricsSearchItem {
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
 * A letra que vai ao worker. Música nova (sdd-011): as candidatas dos sites, coletadas agora
 * (no background, depois do 202), para o worker escolher com a transcrição. Música antiga: a
 * letra do LRCLIB, só para alinhar (sdd-010).
 */
async function lyricsInput(song: SongSummary): Promise<WorkerLyricsInput> {
  if (song.sourceVideoId === null) return { kind: "known", lines: song.lyrics as LyricLine[] };
  const candidates = await lyricsSourceService.collect({
    artist: song.artist,
    title: song.title,
    durationMs: song.durationMs,
    videoId: song.sourceVideoId,
  });
  return { kind: "candidates", candidates, prompt: `${song.artist} - ${song.title}` };
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
 * Reserva a música para processamento (regras 4, 5 e 6; com `redo`, também `READY`, sdd-010).
 * Quando o claim falha, relê o status para responder o 409 certo.
 */
async function claim(id: string, youtubeVideoId: string | null, redo: boolean): Promise<SongSummary> {
  const song = await songRepository.findById(id);
  if (!song) throw new SongNotFoundError(id);

  const claimed = await songRepository.claimForProcessing(id, youtubeVideoId, { redo });
  if (claimed) {
    // O claim zerou a `stemsKey` (sdd-016): a pasta da referência anterior sai antes de a nova
    // extração começar (melhor esforço; o que sobrar, a varredura do boot apaga).
    if (song.stemsKey !== null) await stemsRepository.prune(song.id, null);
    return song;
  }

  const current = await songRepository.findById(id);
  if (current?.referenceStatus === "READY") throw new ReferenceAlreadyReadyError();
  throw new ReferenceAlreadyProcessingError();
}

/**
 * Guarda as trilhas da referência (sdd-016) sob uma chave nova e a devolve; `null` se o disco
 * recusou (cheio, sem permissão): a referência fica `READY` sem trilhas e o karaokê usa o
 * fallback da sdd-013 (regra 4: as trilhas nunca derrubam a referência).
 */
async function storeStems(songId: string, files: WorkerStemFiles): Promise<string | null> {
  const key = randomUUID();
  try {
    await stemsRepository.save(songId, key, files);
    return key;
  } catch (error) {
    if (env.NODE_ENV !== "test") {
      console.error(`[song.service] could not store the stems of song ${songId}:`, error);
    }
    await stemsRepository.prune(songId, null);
    return null;
  }
}

/**
 * Processamento em background (a rota já respondeu 202). Todo desfecho termina gravado na
 * música: `READY` com a curva ou `FAILED` com um `ReferenceErrorCode`. Nunca rejeita.
 */
async function runReference(song: SongSummary, extract: (lyrics: WorkerLyricsInput) => Promise<WorkerExtraction>): Promise<void> {
  try {
    const input = await lyricsInput(song);
    const { track, alignment: forced, lyrics: selected, transcript, stems } = await extract(input);

    if (Math.abs(track.durationMs - song.durationMs) > DURATION_TOLERANCE_MS) {
      await songRepository.markFailed(song.id, {
        referenceError: "DURATION_MISMATCH",
        referenceAudioMs: track.durationMs,
      });
      return;
    }

    // Música nova: a letra é a que o worker escolheu (sdd-011), com `startMs` de dica.
    const lyrics: LyricLine[] = selected ? selected.lines : (song.lyrics as LyricLine[]);

    // A letra é alinhada ao mesmo áudio de onde saiu a curva: pelo texto, com o alinhamento
    // forçado do worker (sdd-010), ou pelas pausas da voz quando ele não veio (sdd-007).
    const alignment = alignmentService.align(lyrics, track, forced);

    // As trilhas vão para o disco ANTES do `READY` (sdd-016): a chave só existe com os arquivos.
    const stemsKey = stems ? await storeStems(song.id, stems) : null;

    await songRepository.markReady(song.id, {
      referenceTrack: track,
      referenceAudioMs: track.durationMs,
      stemsKey,
      ...toAlignmentData(alignment),
      ...(selected
        ? {
            lyrics,
            lyricsSelection: { source: selected.source, wer: selected.wer, candidates: selected.candidates } satisfies LyricsSelection,
            // O que sobrou da escolha fica para a revisão da letra (sdd-012, regra 1).
            lyricsEvidence: {
              transcript: transcript ?? [],
              candidates:
                input.kind === "candidates"
                  ? input.candidates.map(({ source, lines }) => ({ source, lines: lines.map(({ text, startMs }) => ({ text, startMs })) }))
                  : [],
            } satisfies LyricsEvidence,
          }
        : {}),
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
  /**
   * Busca no YouTube Music (sdd-011, regra 1), anexando o estado local em 1 query: por vídeo
   * escolhido (música nova) ou por vídeo da referência (música antiga). Na dúvida, a nova.
   */
  async search(q: string): Promise<SongSearchItem[]> {
    let results: WorkerYtmusicSong[];
    try {
      results = (await workerClient.searchYtmusic(q)).slice(0, SEARCH_LIMIT);
    } catch {
      throw new YoutubeSearchUnavailableError();
    }

    const known = await songRepository.findByVideoIds(results.map((result) => result.videoId));
    const bySource = new Map(known.filter((song) => song.sourceVideoId).map((song) => [song.sourceVideoId, song]));
    const byReference = new Map(known.filter((song) => song.youtubeVideoId).map((song) => [song.youtubeVideoId, song]));

    return results.map((result) => toSearchItem(result, bySource.get(result.videoId) ?? byReference.get(result.videoId)));
  },

  /**
   * Busca pela letra no LRCLIB (sdd-015, o caminho principal): só letra sincronizada (regra 2),
   * com o estado local anexado em 1 query. LRCLIB fora → `LyricsProviderUnavailableError` (502).
   */
  async searchLyrics(q: string): Promise<LyricsSearchItem[]> {
    const tracks = (await lrclibClient.search(q)).filter((track) => track.syncedLyrics !== null).slice(0, SEARCH_LIMIT);

    const known = await songRepository.findByLrclibIds(tracks.map((track) => track.id));
    const byLrclibId = new Map(known.map((song) => [song.lrclibId, song]));

    return tracks.map((track) => toLyricsSearchItem(track, byLrclibId.get(track.id)));
  },

  /**
   * Cadastro pela letra (sdd-015, regra 3): idempotente por `lrclibId`, com a letra sincronizada
   * já parseada e a referência em `NONE`. Ela começa quando a pessoa escolhe o vídeo na
   * preparação (sdd-008), e o worker recebe a letra pronta: sem Whisper.
   */
  async createFromLyrics(lrclibId: number): Promise<CreateSongResult> {
    const existing = await songRepository.findByLrclibId(lrclibId);
    if (existing) return { song: toSongDto(existing), created: false };

    const track = await lrclibClient.getById(lrclibId);
    if (!track) throw new SongNotFoundError(lrclibId);

    const lyrics = track.syncedLyrics ? parseLrc(track.syncedLyrics) : [];
    if (lyrics.length === 0) throw new SongWithoutSyncedLyricsError(lrclibId);

    try {
      const song = await songRepository.upsertByLrclibId({
        lrclibId,
        artist: track.artistName,
        title: track.trackName,
        album: track.albumName,
        durationMs: toMs(track.duration),
        lyrics,
      });
      return { song: toSongDto(song), created: true };
    } catch (error) {
      // Duas criações ao mesmo tempo: o upsert do Postgres pode perder a corrida no índice único.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      const winner = await songRepository.findByLrclibId(lrclibId);
      if (!winner) throw error;
      return { song: toSongDto(winner), created: false };
    }
  },

  /**
   * Cadastro pelo vídeo escolhido na busca (sdd-011): idempotente por `sourceVideoId` (regra 2)
   * e já começa a referência (regra 3). Chamadas concorrentes criam 1 música e 1
   * processamento: o índice único de `sourceVideoId` e o claim atômico decidem.
   */
  async createFromVideo(videoId: string): Promise<CreateSongResult> {
    const existing = await songRepository.findBySourceVideoId(videoId);
    if (existing) return { song: toSongDto(existing), created: false };

    let metadata: WorkerYtmusicSong;
    try {
      metadata = await workerClient.getYtmusicSong(videoId);
    } catch {
      throw new VideoMetadataUnavailableError(videoId);
    }
    if (metadata.durationS === null) throw new VideoMetadataUnavailableError(videoId);

    let song: SongSummary;
    try {
      song = await songRepository.createFromVideo({
        sourceVideoId: videoId,
        artist: metadata.artist,
        title: metadata.title,
        album: metadata.album,
        durationMs: toMs(metadata.durationS),
      });
    } catch (error) {
      // Outra chamada cadastrou o mesmo vídeo antes: esta devolve a música dela (200).
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      const winner = await songRepository.findBySourceVideoId(videoId);
      if (!winner) throw error;
      return { song: toSongDto(winner), created: false };
    }

    try {
      await songService.startReferenceFromYoutube(song.id, videoId);
    } catch (error) {
      // Outra chamada já começou: a música está processando, que é o que se queria.
      if (!(error instanceof ReferenceAlreadyProcessingError || error instanceof ReferenceAlreadyReadyError)) throw error;
    }

    const fresh = await songRepository.findById(song.id);
    return { song: toSongDto(fresh ?? song), created: true };
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
        return toSongDto({ ...song, alignedLyrics: alignment.lines, lyricsAlignment: toDiagnostic(alignment) });
      }
    }

    return toSongDto(song);
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
  async startReference(id: string, audio: Buffer, filename: string, { redo = false }: ReferenceOptions = {}): Promise<ReferenceStarted> {
    const song = await claim(id, null, redo);

    // Com as trilhas (sdd-016): a música por arquivo enviado também toca pelas trilhas guardadas.
    void runReference(song, (lyrics) => workerClient.extract(audio, filename, lyrics, { stems: true }));

    return { status: "PROCESSING" };
  },

  /** Referência a partir do YouTube. Só o `videoId` chega aqui (regra 11). */
  async startReferenceFromYoutube(id: string, videoId: string, { redo = false }: ReferenceOptions = {}): Promise<YoutubeReferenceStarted> {
    const song = await claim(id, videoId, redo);

    void runReference(song, (lyrics) => workerClient.extractFromYoutube(videoId, lyrics, { stems: true }));

    return { status: "PROCESSING", youtubeVideoId: videoId };
  },

  /**
   * Uma trilha guardada (sdd-016), em streaming do disco. Só música `READY` com `stemsKey`;
   * arquivo que sumiu da pasta também é `STEMS_NOT_STORED` (404): o web cai no fallback.
   */
  async getStem(id: string, stem: StemName): Promise<StoredStem> {
    const song = await songRepository.findById(id);
    if (!song) throw new SongNotFoundError(id);
    if (song.referenceStatus !== "READY" || song.stemsKey === null) throw new StemsNotStoredError();

    const stored = await stemsRepository.open(id, song.stemsKey, stem);
    if (!stored) throw new StemsNotStoredError();
    return stored;
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

  /**
   * Voz e instrumental do áudio que o browser já tem (sdd-013): o worker separa na hora e a
   * resposta é repassada em streaming. Nada fica no servidor (regra 1); o cache é do aparelho.
   * A música precisa existir; o áudio não precisa ser o da referência.
   */
  async separateStems(id: string, audio: Buffer, filename: string): Promise<WorkerStems> {
    const song = await songRepository.findById(id);
    if (!song) throw new SongNotFoundError(id);

    try {
      return await workerClient.separateStems(audio, filename);
    } catch (error) {
      if (error instanceof WorkerClientError && error.code in STEMS_AUDIO_REJECTIONS) {
        throw new StemsAudioRejectedError(error.code as keyof typeof STEMS_AUDIO_REJECTIONS);
      }
      throw new StemsUnavailableError();
    }
  },
};
