import { lrclibClient, type LrclibTrack } from "../clients/lrclib.client.js";
import { workerClient, type WorkerLyricsCandidate, type WorkerYtmusicLyrics } from "../clients/worker.client.js";
import { env } from "../config/env.js";
import { parseLrc } from "../utils/lrc.js";

/** Tolerância de duração da referência (regra 7 da sdd-003); a mesma do `song.service.ts`. */
const DURATION_TOLERANCE_MS = 10_000;

/**
 * Coleta das letras candidatas de uma música nova (sdd-011, regra 5). Quem escolhe entre elas
 * é o worker, que tem a transcrição da voz; aqui só se junta o que os sites têm.
 */
export const LYRICS_SOURCE_CONFIG = {
  /** Faixas do LRCLIB com a duração da música que viram candidatas (synced antes de plain). */
  lrclibMaxCandidates: 2,
  durationToleranceMs: DURATION_TOLERANCE_MS,
} as const;

/**
 * Faixas do LRCLIB → candidatas: só as com a duração da música (±10 s), a letra sincronizada
 * antes da só em texto, no máximo `lrclibMaxCandidates`. Texto sem tempo vira uma linha por
 * linha não vazia, com `startMs` nulo (o worker põe a dica).
 */
export function lrclibCandidates(tracks: LrclibTrack[], song: { durationMs: number }): WorkerLyricsCandidate[] {
  const { durationToleranceMs, lrclibMaxCandidates } = LYRICS_SOURCE_CONFIG;
  const near = tracks
    .filter((track) => Math.abs(Math.round(track.duration * 1000) - song.durationMs) <= durationToleranceMs)
    .map((track, order) => ({ track, order }))
    // `sort` é estável: dentro de cada grupo fica a ordem do LRCLIB.
    .sort((a, b) => Number(a.track.syncedLyrics === null) - Number(b.track.syncedLyrics === null) || a.order - b.order);

  const candidates: WorkerLyricsCandidate[] = [];
  for (const { track } of near) {
    const lines = track.syncedLyrics
      ? parseLrc(track.syncedLyrics)
      : (track.plainLyrics ?? "")
          .split(/\r?\n/)
          .map((text) => text.trim())
          .filter((text) => text.length > 0)
          .map((text) => ({ text, startMs: null }));
    if (lines.length === 0) continue;
    candidates.push({ source: "lrclib", lines });
    if (candidates.length === lrclibMaxCandidates) break;
  }
  return candidates;
}

/** Letra do YouTube Music → candidata; `null` sem letra (`none`), com falha (`error`) ou vazia. */
export function ytmusicCandidate(lyrics: WorkerYtmusicLyrics): WorkerLyricsCandidate | null {
  if (lyrics.status !== "synced" && lyrics.status !== "plain") return null;
  const lines = lyrics.lines.map(({ text, startMs }) => ({ text, startMs }));
  return lines.length > 0 ? { source: "ytmusic", lines } : null;
}

function logSkipped(source: string, reason: unknown): void {
  if (env.NODE_ENV !== "test") console.warn(`[lyrics-source] ${source} skipped:`, reason);
}

export const lyricsSourceService = {
  /**
   * LRCLIB e YouTube Music em paralelo. Fonte que falha só não entra (lista vazia é válida: o
   * worker usa a transcrição). Ordem: YouTube Music primeiro (empates no worker preferem ele).
   */
  async collect(song: { artist: string; title: string; durationMs: number; videoId: string | null }): Promise<WorkerLyricsCandidate[]> {
    const [ytmusic, lrclib] = await Promise.allSettled([
      song.videoId ? workerClient.getYtmusicSong(song.videoId) : Promise.resolve(null),
      lrclibClient.find({ artist: song.artist, title: song.title }),
    ]);

    const candidates: WorkerLyricsCandidate[] = [];
    if (ytmusic.status === "fulfilled") {
      const candidate = ytmusic.value ? ytmusicCandidate(ytmusic.value.lyrics) : null;
      if (candidate) candidates.push(candidate);
    } else {
      logSkipped("YouTube Music", ytmusic.reason);
    }
    if (lrclib.status === "fulfilled") {
      candidates.push(...lrclibCandidates(lrclib.value, song));
    } else {
      logSkipped("LRCLIB", lrclib.reason);
    }
    return candidates;
  },
};
