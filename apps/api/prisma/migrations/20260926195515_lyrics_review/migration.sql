-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "lyricsEvidence" JSONB,
ADD COLUMN     "lyricsRevision" INTEGER NOT NULL DEFAULT 0;
