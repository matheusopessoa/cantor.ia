/**
 * Espelho dos contratos públicos da API (sdd-003). A origem de cada tipo é o código de
 * `apps/api`; se algo divergir, o código da API prevalece e este arquivo é corrigido.
 *
 * - `PitchTrack`, `LyricLine`, `LyricsAlignment`, `Difficulty`: `apps/api/src/utils/validators.ts`
 * - `ReferenceStatus`, `ReferenceErrorCode`: `apps/api/prisma/schema.prisma`
 * - `SongSearchItem`, `LyricsSearchItem`, `SongDto`: `apps/api/src/services/song.service.ts`
 * - `PerformanceResult`, `RankingItem`, `LineResult`: `apps/api/src/services/performance.service.ts`
 *   e `scoring.service.ts`
 * - `YoutubeSuggestion`, `YoutubeCandidateDto`: `apps/api/src/services/youtube-suggestion.service.ts`
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
  | "INTERNAL"
  | "INTERRUPTED";

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
/**
 * Como a letra foi alinhada (sdd-010): `forced` = pelo texto, com o alinhador forçado do
 * worker; `onset` = pelas pausas da voz (sdd-007). Ausente em músicas alinhadas antes da sdd-010.
 */
export type LyricsAlignmentMethod = "forced" | "onset";

export interface LyricsAlignment {
  aligned: boolean;
  shiftMs: number;
  /** Fração das linhas com texto aceitas (`forced`) ou encaixadas numa entrada de voz (`onset`), 0..1. */
  matchedRatio: number;
  method?: LyricsAlignmentMethod;
}

/**
 * De onde veio a letra de uma música nova (sdd-011): um site ou a transcrição da voz
 * (`whisper`, com aviso na tela).
 */
export type LyricsSource = "lrclib" | "ytmusic" | "whisper";

export interface LyricsSelection {
  source: LyricsSource;
  /** Fração de palavras diferentes entre a letra escolhida e a transcrição da voz. */
  wer: number | null;
  candidates: { source: Exclude<LyricsSource, "whisper">; wer: number | null }[];
  /** Quando a letra foi revisada pelo Claude Code via MCP (sdd-012, ISO 8601). A `source` não muda. */
  reviewedAt?: string;
}

/** Um resultado da busca no YouTube Music (sdd-011): cada resultado já é o vídeo da música. */
export interface SongSearchItem {
  videoId: string;
  artist: string;
  title: string;
  album: string | null;
  durationMs: number | null;
  /** Preenchidos quando a música já foi cadastrada. */
  songId: string | null;
  referenceStatus: ReferenceStatus | null;
}

/** Um resultado da busca pela letra (LRCLIB, sdd-015): só faixas com letra sincronizada. */
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
  lyrics: LyricLine[];
  referenceStatus: ReferenceStatus;
  referenceError: ReferenceErrorCode | null;
  referenceAudioMs: number | null;
  /** Última mudança de status da referência (ISO 8601); nulo se nunca teve referência. */
  referenceUpdatedAt: string | null;
  youtubeVideoId: string | null;
  /**
   * Letra alinhada ao áudio da referência (sdd-007). Nulo enquanto não `READY` ou quando o
   * alinhamento não bateu: use `effectiveLyrics(song)` (`lib/lyrics.ts`), nunca `lyrics` direto.
   */
  alignedLyrics: LyricLine[] | null;
  /** Diagnóstico do alinhamento; nulo enquanto não `READY`. */
  lyricsAlignment: LyricsAlignment | null;
  /** De onde veio a letra (sdd-011); nulo nas músicas antigas e até a primeira `READY`. */
  lyricsSelection: LyricsSelection | null;
}

export interface ReferenceStarted {
  status: ReferenceStatus;
}

export interface YoutubeReferenceStarted extends ReferenceStarted {
  youtubeVideoId: string;
}

/** Sugestão de vídeo do YouTube (sdd-008): `GET /api/songs/:id/youtube-candidates`. */
export type SuggestionConfidence = "none" | "low" | "medium" | "high";

export type YoutubeCandidateReason =
  | "TOPIC_CHANNEL"
  | "OFFICIAL_AUDIO"
  | "ARTIST_CHANNEL"
  | "LYRIC_VIDEO"
  | "OFFICIAL"
  | "MOST_VIEWED"
  | "EXACT_DURATION";

export interface YoutubeCandidateDto {
  videoId: string;
  title: string;
  channel: string | null;
  durationMs: number;
  viewCount: number | null;
  score: number;
  /** 1 = tem marca de oficial; 2 = escolhido pelas visualizações. */
  tier: 1 | 2;
  /** Códigos; o texto sai de `candidateBadges` (`lib/youtube.ts`). */
  reasons: YoutubeCandidateReason[];
}

export interface YoutubeSuggestion {
  query: string;
  confidence: SuggestionConfidence;
  /** Até 5, já ordenados. */
  candidates: YoutubeCandidateDto[];
}

/**
 * Nível da nota (sdd-009): fácil não mede afinação, médio tem folga de um semitom, difícil de
 * meio semitom. Rankings são por música e nível.
 */
export type Difficulty = "EASY" | "MEDIUM" | "HARD";

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
  /** Calculada em todos os níveis; no `EASY` não entra na nota. */
  pitchScore: number;
  timingScore: number;
  /** Presença de voz nos lugares certos (0..10). Pesa no `EASY` e no `MEDIUM`. */
  rhythmScore: number;
  difficulty: Difficulty;
  keyOffsetSemitones: number;
  coverage: number;
  lines: LineResult[];
  /** Posição no ranking da música **no nível cantado**. */
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
  difficulty: Difficulty;
  track: PitchTrack;
}
