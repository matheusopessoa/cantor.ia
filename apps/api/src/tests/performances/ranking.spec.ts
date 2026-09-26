import { describe, expect, it } from "vitest";
import { app } from "../../app.js";
import type { Difficulty } from "../../generated/prisma/client.js";
import { prisma } from "../../utils/prisma.js";
import { melody, seedReadySong } from "../helpers/songs.js";

function ranking(id: string, query: Record<string, string> = {}) {
  return app.inject({ method: "GET", url: `/api/songs/${id}/performances`, query });
}

async function seedPerformance(
  songId: string,
  playerName: string,
  score: number,
  createdAt: Date,
  difficulty: Difficulty = "HARD",
) {
  return prisma.performance.create({
    data: {
      songId,
      playerName,
      difficulty,
      score,
      pitchScore: score,
      timingScore: score,
      rhythmScore: score,
      details: { keyOffsetSemitones: 0, coverage: 1, lines: [] },
      sungTrack: melody.track,
      createdAt,
    },
  });
}

describe("GET /api/songs/:id/performances", () => {
  it("ordena por nota desc e, no empate, quem cantou primeiro fica na frente", async () => {
    const song = await seedReadySong();
    await seedPerformance(song.id, "BIA", 8.5, new Date("2026-09-25T10:00:00Z"));
    await seedPerformance(song.id, "ANA", 9.2, new Date("2026-09-25T11:00:00Z"));
    await seedPerformance(song.id, "CAIO", 9.2, new Date("2026-09-25T09:00:00Z"));
    await seedPerformance(song.id, "DUDA", 4.0, new Date("2026-09-25T12:00:00Z"));

    const response = await ranking(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: expect.any(String), playerName: "CAIO", score: 9.2, createdAt: "2026-09-25T09:00:00.000Z" },
      { id: expect.any(String), playerName: "ANA", score: 9.2, createdAt: "2026-09-25T11:00:00.000Z" },
      { id: expect.any(String), playerName: "BIA", score: 8.5, createdAt: "2026-09-25T10:00:00.000Z" },
      { id: expect.any(String), playerName: "DUDA", score: 4, createdAt: "2026-09-25T12:00:00.000Z" },
    ]);
  });

  it("não mistura o ranking de músicas diferentes", async () => {
    const song = await seedReadySong({ lrclibId: 1 });
    const other = await seedReadySong({ lrclibId: 2 });
    await seedPerformance(song.id, "ANA", 9, new Date());
    await seedPerformance(other.id, "BIA", 10, new Date());

    const response = await ranking(song.id);

    expect(response.json().map((item: { playerName: string }) => item.playerName)).toEqual(["ANA"]);
  });

  it("respeita o limit (padrão 10, máximo 50)", async () => {
    const song = await seedReadySong();
    for (let index = 0; index < 12; index++) {
      await seedPerformance(song.id, `P${index}`, index, new Date());
    }

    expect((await ranking(song.id)).json()).toHaveLength(10);
    expect((await ranking(song.id, { limit: "3" })).json()).toHaveLength(3);
    expect((await ranking(song.id, { limit: "50" })).json()).toHaveLength(12);
    expect((await ranking(song.id, { limit: "51" })).statusCode).toBe(400);
    expect((await ranking(song.id, { limit: "0" })).statusCode).toBe(400);
  });

  describe("níveis (sdd-009)", () => {
    it("sem query devolve o ranking do difícil; ?difficulty= filtra o nível", async () => {
      const song = await seedReadySong();
      await seedPerformance(song.id, "ANA", 9, new Date(), "HARD");
      await seedPerformance(song.id, "BIA", 10, new Date(), "EASY");
      await seedPerformance(song.id, "CAIO", 8, new Date(), "MEDIUM");

      const names = (response: Awaited<ReturnType<typeof ranking>>) =>
        response.json().map((item: { playerName: string }) => item.playerName);

      expect(names(await ranking(song.id))).toEqual(["ANA"]);
      expect(names(await ranking(song.id, { difficulty: "HARD" }))).toEqual(["ANA"]);
      expect(names(await ranking(song.id, { difficulty: "EASY" }))).toEqual(["BIA"]);
      expect(names(await ranking(song.id, { difficulty: "MEDIUM" }))).toEqual(["CAIO"]);
    });

    it("o limit continua valendo dentro do nível", async () => {
      const song = await seedReadySong();
      for (let index = 0; index < 5; index++) {
        await seedPerformance(song.id, `E${index}`, index, new Date(), "EASY");
        await seedPerformance(song.id, `H${index}`, index, new Date(), "HARD");
      }

      const response = await ranking(song.id, { difficulty: "EASY", limit: "3" });

      expect(response.json()).toHaveLength(3);
      expect(response.json().every((item: { playerName: string }) => item.playerName.startsWith("E"))).toBe(true);
    });

    it("difficulty inválida → 400", async () => {
      const song = await seedReadySong();

      expect((await ranking(song.id, { difficulty: "expert" })).statusCode).toBe(400);
      expect((await ranking(song.id, { difficulty: "easy" })).statusCode).toBe(400);
    });
  });

  it("música sem performances → []", async () => {
    const song = await seedReadySong();

    const response = await ranking(song.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("nunca devolve sungTrack nem details", async () => {
    const song = await seedReadySong();
    await seedPerformance(song.id, "ANA", 9, new Date());

    const [item] = (await ranking(song.id)).json();

    expect(Object.keys(item).sort()).toEqual(["createdAt", "id", "playerName", "score"]);
  });

  it("música inexistente → 404", async () => {
    const response = await ranking("019a0000-0000-7000-8000-000000000000");

    expect(response.statusCode).toBe(404);
  });
});
