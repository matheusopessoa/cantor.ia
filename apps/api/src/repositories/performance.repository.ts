import type { Difficulty, Performance, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../utils/prisma.js";

export interface CreatePerformanceData {
  songId: string;
  playerName: string;
  /** Nível da nota (sdd-009); define em qual ranking a performance entra. */
  difficulty: Difficulty;
  score: number;
  pitchScore: number;
  timingScore: number;
  rhythmScore: number;
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

  /**
   * Quantas performances da música **no mesmo nível** têm nota maior. Usa o índice
   * `(songId, difficulty, score desc)`.
   */
  countBetter(songId: string, difficulty: Difficulty, score: number): Promise<number> {
    return prisma.performance.count({ where: { songId, difficulty, score: { gt: score } } });
  },

  /**
   * Ranking de um nível: nota desc; no empate, quem cantou primeiro fica na frente (regra 9).
   * Uma nota do fácil nunca aparece na tabela do médio ou do difícil (sdd-009, regra 3).
   */
  findTopBySong(songId: string, difficulty: Difficulty, limit: number): Promise<RankingRow[]> {
    return prisma.performance.findMany({
      where: { songId, difficulty },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
      take: limit,
      select: rankingSelect,
    });
  },
};
