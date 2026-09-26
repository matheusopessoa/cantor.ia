import type { PitchTrack } from "./types";

/** Mesmos limites de `pitchTrackSchema` (`apps/api/src/utils/validators.ts`). */
export const HOP_MS = 10;
export const MIDI_MIN = 20;
export const MIDI_MAX = 110;
export const MAX_DURATION_MS = 600_000;

/** Faixa de voz cantada aceita pelo detector (Hz) e clareza mínima do pitchy. */
export const VOICE_MIN_HZ = 65;
export const VOICE_MAX_HZ = 1100;
export const MIN_CLARITY = 0.9;
/** Abaixo deste RMS o bloco é silêncio (evita "pitch" de ruído de fundo). */
export const RMS_GATE = 0.01;

/** Limiares de acerto em cents, iguais aos da nota (sdd-002). */
export const PERFECT_CENTS = 50;
export const GOOD_CENTS = 100;

export type Hit = "perfect" | "good" | "miss";

/** Frequência em Hz → nota MIDI fracionária (69 = A4 = 440 Hz). */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Traz a nota cantada para a oitava mais próxima da referência: quem canta uma oitava
 * abaixo vê a curva sobre a melodia, igual à regra da nota (módulo 12). Sem referência
 * no frame, devolve a nota como está.
 */
export function foldToReference(sung: number, ref: number | null): number {
  if (ref === null) return sung;
  let folded = sung;
  while (folded - ref > 6) folded -= 12;
  while (ref - folded > 6) folded += 12;
  return folded;
}

/** Diferença em cents (positivo = cantou acima), já dobrada para a oitava da referência. */
export function centsFromReference(sung: number, ref: number): number {
  return (foldToReference(sung, ref) - ref) * 100;
}

export function hitForCents(cents: number): Hit {
  const abs = Math.abs(cents);
  if (abs <= PERFECT_CENTS) return "perfect";
  if (abs <= GOOD_CENTS) return "good";
  return "miss";
}

/**
 * Converte a detecção bruta do pitchy num frame do `PitchTrack`: `null` para silêncio,
 * pouca clareza ou frequência fora da faixa de voz.
 */
export function detectionToMidi(hz: number, clarity: number, rms: number): number | null {
  if (rms < RMS_GATE || clarity < MIN_CLARITY) return null;
  if (!Number.isFinite(hz) || hz < VOICE_MIN_HZ || hz > VOICE_MAX_HZ) return null;
  const midi = hzToMidi(hz);
  if (midi < MIDI_MIN || midi > MIDI_MAX) return null;
  return midi;
}

/**
 * Monta o `PitchTrack` enviado à API a partir dos frames gravados (um a cada 10 ms).
 * Frames faltantes viram `null`; excedentes são cortados; valores fora de [20, 110]
 * viram `null` para nunca reprovar no `pitchTrackSchema`.
 */
export function framesToTrack(frames: readonly (number | null)[], durationMs: number): PitchTrack {
  const safeDuration = Math.min(MAX_DURATION_MS, Math.max(HOP_MS, Math.round(durationMs)));
  const length = Math.max(1, Math.round(safeDuration / HOP_MS));
  const midi: (number | null)[] = new Array(length).fill(null);

  for (let i = 0; i < length && i < frames.length; i++) {
    const value = frames[i];
    if (typeof value === "number" && Number.isFinite(value) && value >= MIDI_MIN && value <= MIDI_MAX) {
      midi[i] = value;
    }
  }

  return { version: 1, hopMs: HOP_MS, durationMs: safeDuration, midi };
}

/**
 * Erro médio (cents) da voz contra a referência em [from, to). Devolve `null` quando a
 * referência não tem voz no trecho; frames em que a pessoa não cantou contam como erro
 * máximo (MISS), como na nota oficial.
 */
export function meanCentsError(
  reference: readonly (number | null)[],
  voice: readonly (number | null)[],
  from: number,
  to: number,
): number | null {
  let total = 0;
  let count = 0;

  for (let i = Math.max(0, from); i < to && i < reference.length; i++) {
    const ref = reference[i];
    if (ref === null || ref === undefined) continue;
    const sung = voice[i];
    total += sung === null || sung === undefined ? GOOD_CENTS * 2 : Math.abs(centsFromReference(sung, ref));
    count++;
  }

  return count === 0 ? null : total / count;
}
