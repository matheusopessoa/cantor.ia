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
 * Diagnóstico do alinhamento automático da letra à referência (sdd-007). Convenção de sinal:
 * `alinhado = original + shiftMs`. `aligned: false` → `alignedLyrics` fica nulo e os
 * consumidores usam `lyrics`.
 */
export const lyricsAlignmentSchema = z.object({
    aligned: z.boolean(),
    shiftMs: z.number().int(),
    matchedRatio: z.number().min(0).max(1),
});
export type LyricsAlignment = z.infer<typeof lyricsAlignmentSchema>;

// ─── Músicas, referência e performances (sdd-003) ───────────────────────────

export const songSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });

export const createSongBodySchema = z.object({ lrclibId: z.number().int().positive() });

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

export const performanceBodySchema = z.object({
    playerName: playerNameSchema,
    offsetMs: z.number().int().min(-LYRICS_OFFSET_LIMIT_MS).max(LYRICS_OFFSET_LIMIT_MS).default(0),
    track: pitchTrackSchema,
});
export type PerformanceBody = z.infer<typeof performanceBodySchema>;

export const rankingQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const youtubeReferenceBodySchema = z.object({ url: z.string().trim().min(1).max(300) });
