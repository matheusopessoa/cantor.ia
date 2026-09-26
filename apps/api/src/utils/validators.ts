import { z } from "zod";

export const registerUserBodySchema = z.object({
    email: z.email(),
    password: z.string().min(8),
    name: z.string().min(1),
});

export const loginBodySchema = z.object({
    email: z.email(),
    password: z.string().min(8)
})

/**
 * Curva de pitch produzida pelo worker (contrato em `specs/sdd-001-worker-pitch/tasks.md` §4).
 * Um valor a cada `hopMs`; nota MIDI fracionária (69 = A4 440 Hz) ou `null` sem voz.
 */
export const pitchTrackSchema = z.object({
    version: z.literal(1),
    hopMs: z.literal(10),
    durationMs: z.number().int().positive().max(600_000),
    midi: z.array(z.number().min(20).max(110).nullable()).min(1).max(60_000),
});
export type PitchTrack = z.infer<typeof pitchTrackSchema>;

/** Uma linha da letra sincronizada (LRC): instante de entrada e texto. */
export const lyricLineSchema = z.object({
    startMs: z.number().int().nonnegative(),
    text: z.string(),
});
export type LyricLine = z.infer<typeof lyricLineSchema>;

/**
 * Como a letra foi alinhada (sdd-010): `forced` = pelo texto, com o alinhador forçado do
 * worker; `onset` = pelas pausas da voz (sdd-007), usado quando o worker não devolve
 * alinhamento.
 */
export const lyricsAlignmentMethodSchema = z.enum(["forced", "onset"]);
export type LyricsAlignmentMethod = z.infer<typeof lyricsAlignmentMethodSchema>;

/**
 * Diagnóstico do alinhamento automático da letra à referência (sdd-007). Convenção de sinal:
 * `alinhado = original + shiftMs`. `aligned: false` → `alignedLyrics` fica nulo e os
 * consumidores usam `lyrics`. `method` é opcional porque registros gravados pela sdd-007
 * não têm o campo.
 */
export const lyricsAlignmentSchema = z.object({
    aligned: z.boolean(),
    shiftMs: z.number().int(),
    matchedRatio: z.number().min(0).max(1),
    method: lyricsAlignmentMethodSchema.optional(),
});
export type LyricsAlignment = z.infer<typeof lyricsAlignmentSchema>;

/**
 * Alinhamento forçado devolvido pelo worker (sdd-010, `apps/worker/app/schemas.py`): uma
 * entrada por linha da letra enviada, na mesma ordem. `startMs`/`endMs`/`score` nulos em
 * linha sem texto alinhável. `score` = média das probabilidades dos caracteres da linha.
 */
export const lineAlignmentSchema = z.object({
    index: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative().nullable(),
    endMs: z.number().int().nonnegative().nullable(),
    score: z.number().min(0).max(1).nullable(),
});
export type LineAlignment = z.infer<typeof lineAlignmentSchema>;

export const forcedAlignmentSchema = z.object({
    version: z.literal(1),
    model: z.literal("mms_fa"),
    frameMs: z.literal(20),
    lines: z.array(lineAlignmentSchema),
});
export type ForcedAlignment = z.infer<typeof forcedAlignmentSchema>;

// ─── Escolha da letra entre várias fontes (sdd-011) ─────────────────────────

/** De onde veio a letra de uma música nova: um site ou a transcrição da voz (`whisper`). */
export const lyricsSourceSchema = z.enum(["lrclib", "ytmusic", "whisper"]);
export type LyricsSource = z.infer<typeof lyricsSourceSchema>;

/** Uma candidata avaliada pelo worker; `wer` nulo se ela não tem palavras ou a transcrição veio vazia. */
export const lyricsCandidateScoreSchema = z.object({
    source: z.enum(["lrclib", "ytmusic"]),
    wer: z.number().min(0).nullable(),
});

/**
 * Diagnóstico da escolha da letra (gravado em `Song.lyricsSelection`). `wer` = fração de
 * palavras diferentes entre a escolhida e a transcrição da voz; nulo em `whisper` ou quando
 * não houve transcrição.
 */
export const lyricsSelectionSchema = z.object({
    source: lyricsSourceSchema,
    wer: z.number().min(0).nullable(),
    candidates: z.array(lyricsCandidateScoreSchema),
    /** Quando a letra foi revisada pelo MCP (sdd-012, ISO 8601). A `source` não muda. */
    reviewedAt: z.iso.datetime().optional(),
});
export type LyricsSelection = z.infer<typeof lyricsSelectionSchema>;

// ─── Revisão da letra pelo MCP (sdd-012) ────────────────────────────────────

/** Uma palavra da transcrição do Whisper, como o worker devolve. */
export const transcriptWordSchema = z.object({
    text: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    probability: z.number().min(0).max(1),
});
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

/**
 * O que ficou da última referência de uma música nova para a revisão (`Song.lyricsEvidence`):
 * a transcrição da voz e as letras candidatas dos sites. Nunca sai no `SongDto`.
 */
export const lyricsEvidenceSchema = z.object({
    transcript: z.array(transcriptWordSchema).max(20_000),
    candidates: z.array(
        z.object({
            source: z.enum(["lrclib", "ytmusic"]),
            lines: z.array(z.object({ text: z.string(), startMs: z.number().int().nonnegative().nullable() })),
        }),
    ),
});
export type LyricsEvidence = z.infer<typeof lyricsEvidenceSchema>;

export const reviewListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** A proposta é a letra inteira, verso a verso; linha vazia é instrumental e é mantida. */
export const reviewCheckBodySchema = z.object({
    lines: z.array(z.string().trim().max(300)).min(1).max(500),
});

export const reviewApplyBodySchema = z.object({ checkId: z.uuid() });

/** A letra escolhida pelo worker, linha a linha, com `startMs` de dica (o tempo final vem do alinhamento). */
export const selectedLyricsSchema = lyricsSelectionSchema.extend({
    lines: z.array(z.object({ text: z.string(), startMs: z.number().int().nonnegative() })).max(2_000),
});
export type SelectedLyrics = z.infer<typeof selectedLyricsSchema>;

// ─── Músicas, referência e performances (sdd-003) ───────────────────────────

export const songSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });

/** Id de vídeo do YouTube: 11 caracteres `[A-Za-z0-9_-]` (mesma regra do worker). */
export const youtubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

/**
 * Cadastro: pelo vídeo escolhido na busca do YouTube Music (sdd-011) **ou** pela faixa do LRCLIB
 * escolhida na busca pela letra (sdd-015). Um dos dois, nunca os dois nem campo a mais.
 */
export const createSongBodySchema = z.union([
  z.strictObject({ videoId: youtubeVideoIdSchema }),
  z.strictObject({ lrclibId: z.number().int().positive() }),
]);

export const songParamsSchema = z.object({ id: z.uuid() });

/** Nome de fliperama: letras, números, espaço, ponto, sublinhado e hífen. Sem HTML. */
export const playerNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[\p{L}\p{N} ._-]+$/u);

/**
 * Limite do ajuste manual da letra. A referência aceita áudio até 10 s diferente da letra
 * (`DURATION_TOLERANCE_MS`), então o desvio de intro pode chegar a isso. O ajuste só desloca
 * a letra: nunca muda a velocidade dela.
 */
export const LYRICS_OFFSET_LIMIT_MS = 10_000;

/**
 * Nível da nota (sdd-009), espelho do enum `Difficulty` do Prisma. Sem o campo vale `HARD`:
 * é o comportamento que clientes antigos conhecem e o ranking onde ficam as performances
 * anteriores à sdd-009.
 */
export const difficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
export type Difficulty = z.infer<typeof difficultySchema>;

export const performanceBodySchema = z.object({
    playerName: playerNameSchema,
    offsetMs: z.number().int().min(-LYRICS_OFFSET_LIMIT_MS).max(LYRICS_OFFSET_LIMIT_MS).default(0),
    difficulty: difficultySchema.default("HARD"),
    track: pitchTrackSchema,
});
export type PerformanceBody = z.infer<typeof performanceBodySchema>;

export const rankingQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
    difficulty: difficultySchema.default("HARD"),
});

/**
 * `redo: true` reprocessa uma referência `READY` (melodia e letra, sdd-010). Sem a flag,
 * `READY` continua respondendo 409 (sdd-003, regra 5).
 */
export const youtubeReferenceBodySchema = z.object({
    url: z.string().trim().min(1).max(300),
    redo: z.boolean().default(false),
});

/** Mesma flag no upload, como campo de texto do multipart (`"true"`/`"false"`). */
export const referenceRedoSchema = z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true");
