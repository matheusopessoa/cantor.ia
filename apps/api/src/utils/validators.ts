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

export const performanceBodySchema = z.object({
    playerName: playerNameSchema,
    offsetMs: z.number().int().min(-2000).max(2000).default(0),
    track: pitchTrackSchema,
});
export type PerformanceBody = z.infer<typeof performanceBodySchema>;

export const rankingQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const youtubeReferenceBodySchema = z.object({ url: z.string().trim().min(1).max(300) });
