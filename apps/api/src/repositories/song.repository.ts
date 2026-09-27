import { Prisma, type ReferenceErrorCode, type ReferenceStatus, type Song } from "../generated/prisma/client.js";
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
  sourceVideoId: true,
  artist: true,
  title: true,
  album: true,
  durationMs: true,
  lyrics: true,
  referenceStatus: true,
  referenceError: true,
  referenceAudioMs: true,
  youtubeVideoId: true,
  alignedLyrics: true,
  lyricsAlignment: true,
  lyricsSelection: true,
  lyricsRevision: true,
  referenceUpdatedAt: true,
  stemsKey: true,
  createdAt: true,
} satisfies Prisma.SongSelect;

export type SongSummary = Prisma.SongGetPayload<{ select: typeof songSummarySelect }>;

/** Só a revisão da letra (sdd-012) carrega a evidência (transcrição + candidatas, até ~60 KB). */
const songReviewSelect = { ...songSummarySelect, lyricsEvidence: true } satisfies Prisma.SongSelect;

export type SongForReview = Prisma.SongGetPayload<{ select: typeof songReviewSelect }>;

/** O que a lista de músicas para revisar precisa (sdd-012): sem curva, sem evidência. */
const reviewRowSelect = {
  id: true,
  artist: true,
  title: true,
  lyrics: true,
  lyricsSelection: true,
  lyricsAlignment: true,
  createdAt: true,
} satisfies Prisma.SongSelect;

export type ReviewRow = Prisma.SongGetPayload<{ select: typeof reviewRowSelect }>;

/** O mínimo para anexar o estado da música aos resultados da busca (sdd-011: por vídeo). */
const songLookupSelect = {
  id: true,
  sourceVideoId: true,
  referenceStatus: true,
  youtubeVideoId: true,
} satisfies Prisma.SongSelect;

export type SongLookup = Prisma.SongGetPayload<{ select: typeof songLookupSelect }>;

/** O mínimo para anexar o estado da música aos resultados da busca pela letra (sdd-015). */
const lyricsLookupSelect = {
  id: true,
  lrclibId: true,
  referenceStatus: true,
  youtubeVideoId: true,
} satisfies Prisma.SongSelect;

export type LyricsLookup = Prisma.SongGetPayload<{ select: typeof lyricsLookupSelect }>;

/** Música cadastrada pela busca da letra (sdd-015; era o único cadastro antes da sdd-011). */
export interface CreateSongFromLyricsData {
  lrclibId: number;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  /** `LyricLine[]`: a letra sincronizada do LRCLIB, já parseada. */
  lyrics: Prisma.InputJsonValue;
}

/** Música nova, pelo vídeo escolhido na busca (sdd-011). A letra só existe depois da referência. */
export interface CreateSongFromVideoData {
  sourceVideoId: string;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
}

/** Alinhamento da letra à referência atual (sdd-007). */
export interface AlignmentData {
  /** `LyricLine[]`, ou `Prisma.DbNull` quando o alinhamento não bateu. */
  alignedLyrics: Prisma.InputJsonValue | typeof Prisma.DbNull;
  /** `LyricsAlignment` */
  lyricsAlignment: Prisma.InputJsonValue;
}

export interface MarkReadyData extends AlignmentData {
  /** `PitchTrack` */
  referenceTrack: Prisma.InputJsonValue;
  referenceAudioMs: number;
  /**
   * Música nova (sdd-011): a letra escolhida pelo worker (`LyricLine[]`) e o diagnóstico da
   * escolha (`LyricsSelection`), gravados junto da curva. Ausentes na música antiga.
   */
  lyrics?: Prisma.InputJsonValue;
  lyricsSelection?: Prisma.InputJsonValue;
  /** `LyricsEvidence` (sdd-012): transcrição e candidatas, para a revisão. Só na música nova. */
  lyricsEvidence?: Prisma.InputJsonValue;
  /** Chave da pasta das trilhas gravadas para esta referência (sdd-016); `null` sem trilhas. */
  stemsKey?: string | null;
}

/** Uma música com trilhas guardadas (sdd-016): o que a varredura do boot precisa. */
export interface SongStemsKey {
  id: string;
  stemsKey: string;
}

/** O que uma revisão aplicada grava (sdd-012): a letra nova, o alinhamento dela e o `reviewedAt`. */
export interface LyricsReviewData extends AlignmentData {
  /** `LyricLine[]` */
  lyrics: Prisma.InputJsonValue;
  /** `LyricsSelection` com `reviewedAt` */
  lyricsSelection: Prisma.InputJsonValue;
}

export interface MarkFailedData {
  referenceError: ReferenceErrorCode;
  referenceAudioMs: number | null;
}

export interface ClaimOptions {
  /** Aceita também referência `READY` (refazer melodia e letra, sdd-010). */
  redo: boolean;
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

  /** Estado local dos resultados da busca pela letra, em 1 query (sdd-015). */
  findByLrclibIds(lrclibIds: number[]): Promise<LyricsLookup[]> {
    if (lrclibIds.length === 0) return Promise.resolve([]);
    return prisma.song.findMany({ where: { lrclibId: { in: lrclibIds } }, select: lyricsLookupSelect });
  },

  /**
   * Idempotente por `lrclibId` (sdd-015): se já existe, devolve a música sem alterar nada. Duas
   * criações ao mesmo tempo podem dar `P2002` no índice único; quem chama relê a vencedora.
   */
  upsertByLrclibId(data: CreateSongFromLyricsData): Promise<SongSummary> {
    return prisma.song.upsert({
      where: { lrclibId: data.lrclibId },
      create: data,
      update: {},
      select: songSummarySelect,
    });
  },

  findBySourceVideoId(sourceVideoId: string): Promise<SongSummary | null> {
    return prisma.song.findUnique({ where: { sourceVideoId }, select: songSummarySelect });
  },

  /** Único ponto que carrega a `lyricsEvidence` (o detalhe da revisão, sdd-012). */
  findForReviewDetail(id: string): Promise<SongForReview | null> {
    return prisma.song.findUnique({ where: { id }, select: songReviewSelect });
  },

  /**
   * Músicas `READY` para a lista da revisão (sdd-012), em 1 query e sem curva nem evidência,
   * das mais antigas para as mais novas. Quem ordena por origem da letra e encaixe é o service
   * (os dois vivem em JSON).
   */
  findForReview(): Promise<ReviewRow[]> {
    return prisma.song.findMany({
      where: { referenceStatus: "READY" },
      select: reviewRowSelect,
      orderBy: { createdAt: "asc" },
    });
  },

  /**
   * Estado local dos resultados da busca, em 1 query: músicas novas pelo vídeo escolhido e
   * músicas antigas pelo vídeo da referência (regra 2 da sdd-011).
   */
  findByVideoIds(videoIds: string[]): Promise<SongLookup[]> {
    if (videoIds.length === 0) return Promise.resolve([]);
    return prisma.song.findMany({
      where: { OR: [{ sourceVideoId: { in: videoIds } }, { youtubeVideoId: { in: videoIds } }] },
      select: songLookupSelect,
    });
  },

  /**
   * Cria a música nova. Vídeo já cadastrado → `P2002` no índice único de `sourceVideoId`: quem
   * chama trata como "já existia" (cadastro idempotente, regra 2 da sdd-011).
   */
  createFromVideo(data: CreateSongFromVideoData): Promise<SongSummary> {
    return prisma.song.create({ data: { ...data, lyrics: [] }, select: songSummarySelect });
  },

  /**
   * Transição atômica para `PROCESSING` (regra 4). Só passa se o status for `NONE`/`FAILED`
   * ou um `PROCESSING` abandonado (regra 6); com `redo`, também `READY` (refazer melodia e
   * letra, sdd-010). Grava o `youtubeVideoId` já no claim (regra 12). Devolve `false` quando
   * outra requisição ganhou a corrida ou a referência já está pronta (sem `redo`).
   */
  async claimForProcessing(
    id: string,
    youtubeVideoId: string | null,
    { redo }: ClaimOptions = { redo: false },
    now = new Date(),
  ): Promise<boolean> {
    const staleBefore = new Date(now.getTime() - PROCESSING_STALE_MS);
    const claimable: ReferenceStatus[] = redo ? ["NONE", "FAILED", "READY"] : ["NONE", "FAILED"];

    const { count } = await prisma.song.updateMany({
      where: {
        id,
        OR: [
          { referenceStatus: { in: claimable } },
          { referenceStatus: "PROCESSING", referenceUpdatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        referenceStatus: "PROCESSING",
        referenceUpdatedAt: now,
        youtubeVideoId,
        referenceError: null,
        referenceAudioMs: null,
        // `PROCESSING` não tem curva: no `redo` a anterior sai junto com o alinhamento.
        referenceTrack: Prisma.DbNull,
        // O alinhamento vale só para a referência atual (sdd-007, regra 2), e a escolha da
        // letra também (sdd-011): o redo pode escolher outra. A evidência da revisão idem (sdd-012).
        alignedLyrics: Prisma.DbNull,
        lyricsAlignment: Prisma.DbNull,
        lyricsSelection: Prisma.DbNull,
        lyricsEvidence: Prisma.DbNull,
        // As trilhas são da referência anterior (sdd-016): a pasta é apagada pelo service.
        stemsKey: null,
      },
    });

    return count === 1;
  },

  /**
   * `READY` grava a curva e, junto, a letra alinhada a ela (sdd-007) e, numa música nova, a
   * letra escolhida (sdd-011) com a evidência para a revisão (sdd-012): uma escrita só. Toda
   * `READY` é uma versão nova da letra (`lyricsRevision`), mesmo na música antiga: a letra
   * alinhada mudou.
   */
  async markReady(
    id: string,
    { referenceTrack, referenceAudioMs, alignedLyrics, lyricsAlignment, lyrics, lyricsSelection, lyricsEvidence, stemsKey }: MarkReadyData,
  ): Promise<void> {
    await prisma.song.update({
      where: { id },
      data: {
        referenceStatus: "READY",
        referenceTrack,
        referenceAudioMs,
        alignedLyrics,
        lyricsAlignment,
        ...(lyrics !== undefined ? { lyrics } : {}),
        ...(lyricsSelection !== undefined ? { lyricsSelection } : {}),
        ...(lyricsEvidence !== undefined ? { lyricsEvidence } : {}),
        // As trilhas desta referência (sdd-016), na mesma escrita da curva: nunca uma sem a outra.
        ...(stemsKey !== undefined ? { stemsKey } : {}),
        lyricsRevision: { increment: 1 },
        referenceError: null,
        referenceUpdatedAt: new Date(),
      },
    });
  },

  /**
   * Aplica uma revisão da letra (sdd-012): escrita atômica condicionada à versão conferida e
   * ao `READY`, no modelo do `claimForProcessing`. Devolve `false` quando a letra mudou (redo
   * ou outra revisão no meio) ou a referência saiu de `READY`: nada é gravado.
   */
  async applyLyricsReview(
    id: string,
    revision: number,
    { lyrics, alignedLyrics, lyricsAlignment, lyricsSelection }: LyricsReviewData,
  ): Promise<boolean> {
    const { count } = await prisma.song.updateMany({
      where: { id, lyricsRevision: revision, referenceStatus: "READY" },
      data: { lyrics, alignedLyrics, lyricsAlignment, lyricsSelection, lyricsRevision: { increment: 1 } },
    });
    return count === 1;
  },

  /** Backfill do alinhamento em música `READY` anterior à sdd-007 (regra 9). */
  async saveAlignment(id: string, { alignedLyrics, lyricsAlignment }: AlignmentData): Promise<void> {
    await prisma.song.update({ where: { id }, data: { alignedLyrics, lyricsAlignment } });
  },

  /**
   * Boot da API (achado da sdd-011): o processamento vive no processo da API (`runReference`),
   * então uma API que acabou de subir não tem nenhum em andamento e todo `PROCESSING` no banco é
   * órfão de um reinício ou queda. Vira `FAILED` com `INTERRUPTED`, como o `markFailed`, mas
   * mantém o `youtubeVideoId` (o vídeo da tentativa, para quem quiser refazer com ele; só
   * `READY` serve áudio, então isso não expõe nada). Pressupõe uma instância da API por banco.
   * Só toca no que começou antes de `bootedAt`: um pedido que chegue logo depois do `listen`
   * não é derrubado. Devolve quantas músicas foram marcadas.
   */
  async failOrphanedProcessing(bootedAt: Date, now = new Date()): Promise<number> {
    const { count } = await prisma.song.updateMany({
      where: { referenceStatus: "PROCESSING", referenceUpdatedAt: { lt: bootedAt } },
      data: {
        referenceStatus: "FAILED",
        referenceError: "INTERRUPTED",
        referenceAudioMs: null,
        referenceTrack: Prisma.DbNull,
        alignedLyrics: Prisma.DbNull,
        lyricsAlignment: Prisma.DbNull,
        lyricsSelection: Prisma.DbNull,
        lyricsEvidence: Prisma.DbNull,
        stemsKey: null,
        referenceUpdatedAt: now,
      },
    });
    return count;
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
        alignedLyrics: Prisma.DbNull,
        lyricsAlignment: Prisma.DbNull,
        lyricsEvidence: Prisma.DbNull,
        stemsKey: null,
        youtubeVideoId: null,
        referenceUpdatedAt: new Date(),
      },
    });
  },

  /** Músicas com trilhas guardadas (sdd-016), em 1 query, para a varredura de órfãos no boot. */
  async findStemsKeys(): Promise<SongStemsKey[]> {
    const rows = await prisma.song.findMany({ where: { stemsKey: { not: null } }, select: { id: true, stemsKey: true } });
    return rows.flatMap(({ id, stemsKey }) => (stemsKey === null ? [] : [{ id, stemsKey }]));
  },
};
