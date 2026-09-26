import type { Performance, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../utils/prisma.js";

export interface CreatePerformanceData {
  songId: string;
  playerName: string;
  score: number;
  pitchScore: number;
  timingScore: number;
  offsetMs: number;
  /** `{ keyOffsetSemitones, coverage, lines }` */
  details: Prisma.InputJsonValue;
  /** `PitchTrack` cantado */
  sungTrack: Prisma.InputJsonValue;
}

const rankingSelect = {
  id: true,
  playerName: true,
  score: true,
  createdAt: true,
} satisfies Prisma.PerformanceSelect;

export type RankingRow = Prisma.PerformanceGetPayload<{ select: typeof rankingSelect }>;

export const performanceRepository = {
  create(data: CreatePerformanceData): Promise<Performance> {
    return prisma.performance.create({ data });
  },

  /** Quantas performances da música têm nota maior. Usa o índice `(songId, score desc)`. */
  countBetter(songId: string, score: number): Promise<number> {
    return prisma.performance.count({ where: { songId, score: { gt: score } } });
  },

  /** Ranking: nota desc; no empate, quem cantou primeiro fica na frente (regra 9). */
  findTopBySong(songId: string, limit: number): Promise<RankingRow[]> {
    return prisma.performance.findMany({
      where: { songId },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
      take: limit,
      select: rankingSelect,
    });
  },
};
