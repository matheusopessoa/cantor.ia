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
