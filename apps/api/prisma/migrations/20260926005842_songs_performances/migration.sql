-- CreateEnum
CREATE TYPE "ReferenceStatus" AS ENUM ('NONE', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ReferenceErrorCode" AS ENUM ('VIDEO_UNAVAILABLE', 'TOO_LONG', 'DURATION_MISMATCH', 'NO_VOICE', 'DOWNLOAD_FAILED', 'INVALID_AUDIO', 'INTERNAL');

-- CreateTable
CREATE TABLE "Song" (
    "id" TEXT NOT NULL,
    "lrclibId" INTEGER NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "album" TEXT,
    "durationMs" INTEGER NOT NULL,
    "lyrics" JSONB NOT NULL,
    "referenceStatus" "ReferenceStatus" NOT NULL DEFAULT 'NONE',
    "referenceTrack" JSONB,
    "youtubeVideoId" TEXT,
    "referenceError" "ReferenceErrorCode",
    "referenceAudioMs" INTEGER,
    "referenceUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Performance" (
    "id" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "pitchScore" DOUBLE PRECISION NOT NULL,
    "timingScore" DOUBLE PRECISION NOT NULL,
    "offsetMs" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL,
    "sungTrack" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Performance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Song_lrclibId_key" ON "Song"("lrclibId");

-- CreateIndex
CREATE INDEX "Performance_songId_score_idx" ON "Performance"("songId", "score" DESC);

-- AddForeignKey
ALTER TABLE "Performance" ADD CONSTRAINT "Performance_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
