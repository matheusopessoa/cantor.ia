/**
 * Espelho dos contratos públicos da API (sdd-003). A origem de cada tipo é o código de
 * `apps/api`; se algo divergir, o código da API prevalece e este arquivo é corrigido.
 *
 * - `PitchTrack`, `LyricLine`, `LyricsAlignment`: `apps/api/src/utils/validators.ts`
 * - `ReferenceStatus`, `ReferenceErrorCode`: `apps/api/prisma/schema.prisma`
 * - `SongSearchItem`, `SongDto`: `apps/api/src/services/song.service.ts`
 * - `PerformanceResult`, `RankingItem`, `LineResult`: `apps/api/src/services/performance.service.ts`
 *   e `scoring.service.ts`
 *
 * Follow-up previsto no plano (risco R4): mover para um pacote `packages/contracts`.
 */

export type ReferenceStatus = "NONE" | "PROCESSING" | "READY" | "FAILED";

export type ReferenceErrorCode =
  | "VIDEO_UNAVAILABLE"
  | "TOO_LONG"
  | "DURATION_MISMATCH"
  | "NO_VOICE"
  | "DOWNLOAD_FAILED"
  | "INVALID_AUDIO"
  | "INTERNAL";

/** Curva de pitch (sdd-001): uma nota MIDI fracionária a cada `hopMs`, `null` sem voz. */
export interface PitchTrack {
  version: 1;
  hopMs: 10;
  durationMs: number;
  midi: (number | null)[];
}

export interface LyricLine {
  startMs: number;
  text: string;
}

/**
 * Diagnóstico do alinhamento automático da letra ao áudio da referência (sdd-007).
 * Convenção de sinal: `alinhado = original + shiftMs`.
 */
export interface LyricsAlignment {
  aligned: boolean;
  shiftMs: number;
  /** Fração das linhas com texto que encaixaram numa entrada de voz da referência (0..1). */
  matchedRatio: number;
}

export interface SongSearchItem {
  lrclibId: number;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  songId: string | null;
  referenceStatus: ReferenceStatus | null;
  youtubeVideoId: string | null;
}

export interface SongDto {
  id: string;
  lrclibId: number;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number;
  lyrics: LyricLine[];
  referenceStatus: ReferenceStatus;
  referenceError: ReferenceErrorCode | null;
  referenceAudioMs: number | null;
  youtubeVideoId: string | null;
  /**
   * Letra alinhada ao áudio da referência (sdd-007). Nulo enquanto não `READY` ou quando o
   * alinhamento não bateu: use `effectiveLyrics(song)` (`lib/lyrics.ts`), nunca `lyrics` direto.
   */
  alignedLyrics: LyricLine[] | null;
  /** Diagnóstico do alinhamento; nulo enquanto não `READY`. */
  lyricsAlignment: LyricsAlignment | null;
}

export interface ReferenceStarted {
  status: ReferenceStatus;
}

export interface YoutubeReferenceStarted extends ReferenceStarted {
  youtubeVideoId: string;
}

export interface LineResult {
  index: number;
  /** `startMs` da linha que a nota avaliou: a alinhada (`alignedLyrics`) quando existe (sdd-007). */
  startMs: number;
  onsetDeltaMs: number | null;
  score: number;
}

export interface PerformanceResult {
  id: string;
  playerName: string;
  score: number;
  pitchScore: number;
  timingScore: number;
  keyOffsetSemitones: number;
  coverage: number;
  lines: LineResult[];
  rank: number;
  /** ISO 8601 (o JSON serializa o `Date`). */
  createdAt: string;
}

export interface RankingItem {
  id: string;
  playerName: string;
  score: number;
  createdAt: string;
}

export interface PerformanceBody {
  playerName: string;
  offsetMs: number;
  track: PitchTrack;
}
