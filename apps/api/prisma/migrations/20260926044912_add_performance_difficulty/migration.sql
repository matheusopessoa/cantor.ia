-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- DropIndex
DROP INDEX "Performance_songId_score_idx";

-- AlterTable
ALTER TABLE "Performance" ADD COLUMN     "difficulty" "Difficulty" NOT NULL DEFAULT 'HARD',
ADD COLUMN     "rhythmScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Performance_songId_difficulty_score_idx" ON "Performance"("songId", "difficulty", "score" DESC);
