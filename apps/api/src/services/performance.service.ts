import { performanceRepository } from "../repositories/performance.repository.js";
import { songRepository } from "../repositories/song.repository.js";
import { ReferenceNotReadyError, SongNotFoundError } from "../utils/errors.js";
import type { LyricLine, PerformanceBody, PitchTrack } from "../utils/validators.js";
import { scoringService, type ScoreResult } from "./scoring.service.js";

export interface PerformanceResult extends ScoreResult {
  id: string;
  playerName: string;
  /** Posição no ranking da música: nº de performances com nota maior + 1 (regra 10). */
  rank: number;
  createdAt: Date;
}

export interface RankingItem {
  id: string;
  playerName: string;
  score: number;
  createdAt: Date;
}

export const performanceService = {
  /** Calcula a nota, persiste e devolve a posição no ranking. Sem login (regra 8). */
  async submit(songId: string, { playerName, offsetMs, track }: PerformanceBody): Promise<PerformanceResult> {
    const song = await songRepository.findWithReference(songId);
    if (!song) throw new SongNotFoundError(songId);
    if (song.referenceStatus !== "READY" || song.referenceTrack === null) {
      throw new ReferenceNotReadyError();
    }

    const result = scoringService.score(
      song.referenceTrack as PitchTrack,
      track,
      song.lyrics as LyricLine[],
      { offsetMs },
    );

    const performance = await performanceRepository.create({
      songId,
      playerName,
      score: result.score,
      pitchScore: result.pitchScore,
      timingScore: result.timingScore,
      offsetMs,
      details: {
        keyOffsetSemitones: result.keyOffsetSemitones,
        coverage: result.coverage,
        lines: result.lines.map((line) => ({ ...line })),
      },
      sungTrack: track,
    });

    const better = await performanceRepository.countBetter(songId, result.score);

    return {
      id: performance.id,
      playerName: performance.playerName,
      ...result,
      rank: better + 1,
      createdAt: performance.createdAt,
    };
  },

  async ranking(songId: string, limit: number): Promise<RankingItem[]> {
    const song = await songRepository.findById(songId);
    if (!song) throw new SongNotFoundError(songId);

    return performanceRepository.findTopBySong(songId, limit);
  },
};
