import type { LyricLine, PitchTrack } from "../../utils/validators.js";

export const HOP_MS = 10;

/** PRNG determinístico (mulberry32): mesma seed → mesma sequência em [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

function intBetween(rand: () => number, min: number, max: number): number {
  return Math.floor(between(rand, min, max + 1));
}

/** Espelha o worker: nota MIDI com 2 casas decimais. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function makeTrack(midi: (number | null)[]): PitchTrack {
  return { version: 1, hopMs: 10, durationMs: midi.length * HOP_MS, midi };
}

export interface Melody {
  track: PitchTrack;
  /** Uma linha por frase, no instante em que a frase começa. */
  lines: LyricLine[];
}

const MAJOR_SCALE_C4_E5 = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76];

/**
 * Melodia sintética determinística: frases de 4 a 7 notas (300–600 ms cada) andando ao
 * acaso pela escala maior de C4 a E5, separadas por pausas de 500–900 ms (respiração).
 * Cada frase vira uma linha da letra.
 */
export function makeMelody(seed: number, durationMs: number): Melody {
  const rand = mulberry32(seed);
  const totalFrames = Math.round(durationMs / HOP_MS);
  const midi: (number | null)[] = new Array<number | null>(totalFrames).fill(null);
  const lines: LyricLine[] = [];

  let frame = Math.round(between(rand, 300, 600) / HOP_MS);
  let degree = 4;

  while (frame < totalFrames) {
    lines.push({ startMs: frame * HOP_MS, text: `linha ${lines.length + 1}` });

    const notes = intBetween(rand, 4, 7);
    for (let n = 0; n < notes && frame < totalFrames; n++) {
      degree = Math.min(MAJOR_SCALE_C4_E5.length - 1, Math.max(0, degree + intBetween(rand, -2, 2)));
      const pitch = MAJOR_SCALE_C4_E5[degree] ?? 64;
      const length = Math.round(between(rand, 300, 600) / HOP_MS);
      for (let f = 0; f < length && frame < totalFrames; f++, frame++) {
        midi[frame] = pitch;
      }
    }

    frame += Math.round(between(rand, 500, 900) / HOP_MS);
  }

  return { track: makeTrack(midi), lines };
}

function mapVoiced(track: PitchTrack, fn: (midi: number, frame: number) => number | null): PitchTrack {
  return makeTrack(track.midi.map((value, frame) => (value === null ? null : fn(value, frame))));
}

/** Soma `semitones` a todos os frames com voz. */
export function transpose(track: PitchTrack, semitones: number): PitchTrack {
  return mapVoiced(track, (midi) => round2(midi + semitones));
}

/** Soma `semitones` só aos frames a partir de `fromFraction` da duração (0..1). */
export function detuneFrom(track: PitchTrack, fromFraction: number, semitones: number): PitchTrack {
  const firstFrame = Math.floor(track.midi.length * fromFraction);
  return mapVoiced(track, (midi, frame) => (frame >= firstFrame ? round2(midi + semitones) : midi));
}

/** Desloca a curva no tempo mantendo a duração (positivo = atrasa; o que sobra vira silêncio). */
export function delay(track: PitchTrack, ms: number): PitchTrack {
  const frames = Math.round(ms / HOP_MS);
  const midi = track.midi.map((_, index) => track.midi[index - frames] ?? null);
  return makeTrack(midi);
}

/** Ruído gaussiano (Box-Muller) com desvio-padrão em cents, seedado. */
export function addNoise(track: PitchTrack, seed: number, sigmaCents: number): PitchTrack {
  const rand = mulberry32(seed);
  const sigma = sigmaCents / 100;
  return mapVoiced(track, (midi) => {
    const u1 = Math.max(rand(), Number.EPSILON);
    const u2 = rand();
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return round2(midi + gaussian * sigma);
  });
}

/** Mesma voz/silêncio da referência, mas sempre na mesma nota. */
export function constant(track: PitchTrack, midi: number): PitchTrack {
  return mapVoiced(track, () => midi);
}

/** Silêncio total. */
export function silence(track: PitchTrack): PitchTrack {
  return makeTrack(track.midi.map(() => null));
}

/** Mantém só os primeiros `fraction` da música; o resto vira silêncio. */
export function truncate(track: PitchTrack, fraction: number): PitchTrack {
  const lastFrame = Math.floor(track.midi.length * fraction);
  return makeTrack(track.midi.map((value, frame) => (frame < lastFrame ? value : null)));
}

/**
 * Voz contínua em notas aleatórias (uniforme em [45, 75] MIDI), cada uma segurada por
 * 200–600 ms. Simula alguém falando/cantando sem relação com a música.
 */
export function randomNotes(seed: number, durationMs: number): PitchTrack {
  const rand = mulberry32(seed);
  const totalFrames = Math.round(durationMs / HOP_MS);
  const midi: (number | null)[] = [];
  while (midi.length < totalFrames) {
    const pitch = round2(between(rand, 45, 75));
    const length = Math.round(between(rand, 200, 600) / HOP_MS);
    for (let f = 0; f < length && midi.length < totalFrames; f++) midi.push(pitch);
  }
  return makeTrack(midi);
}

/** Desloca todas as linhas no tempo (positivo = letra atrasada). */
export function shiftLines(lines: LyricLine[], ms: number): LyricLine[] {
  return lines.map((line) => ({ ...line, startMs: line.startMs + ms }));
}

/**
 * Escala o instante de todas as linhas (`factor` > 1 = letra mais lenta). Simula letra
 * cronometrada numa gravação com andamento diferente do áudio.
 */
export function scaleLines(lines: LyricLine[], factor: number): LyricLine[] {
  return lines.map((line) => ({ ...line, startMs: Math.round(line.startMs * factor) }));
}

/** Desloca cada linha por um valor uniforme em [-maxMs, maxMs], seedado (múltiplos de 10 ms). */
export function jitterLines(lines: LyricLine[], seed: number, maxMs: number): LyricLine[] {
  const rand = mulberry32(seed);
  return lines.map((line) => {
    const jitter = Math.round(between(rand, -maxMs, maxMs) / HOP_MS) * HOP_MS;
    return { ...line, startMs: Math.max(0, line.startMs + jitter) };
  });
}
