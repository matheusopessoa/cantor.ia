-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "lyricsSelection" JSONB,
ADD COLUMN     "sourceVideoId" TEXT,
ALTER COLUMN "lrclibId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Song_sourceVideoId_key" ON "Song"("sourceVideoId");

