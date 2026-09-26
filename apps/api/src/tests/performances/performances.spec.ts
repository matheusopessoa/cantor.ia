import { describe, expect, it } from "vitest";
import { app } from "../../app.js";
import { prisma } from "../../utils/prisma.js";
import type { PitchTrack } from "../../utils/validators.js";
import { Prisma } from "../../generated/prisma/client.js";
import { melody, seedReadySong, seedSong } from "../helpers/songs.js";
import { detuneFrom, shiftLines, silence } from "../helpers/tracks.js";

function submit(id: string, body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: `/api/songs/${id}/performances`, payload: body });
}

const perfect = { playerName: "ANA", offsetMs: 0, track: melody.track };

describe("POST /api/songs/:id/performances", () => {
  it("cantar a própria referência vale 10 e fica em 1º", async () => {
    const song = await seedReadySong();

    const response = await submit(song.id, perfect);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      playerName: "ANA",
      score: 10,
      pitchScore: 10,
      timingScore: 10,
      keyOffsetSemitones: 0,
      coverage: 1,
      rank: 1,
      createdAt: expect.any(String),
    });
    expect(response.json().lines).toHaveLength(melody.lines.length);
  });

  it("rank é o número de performances com nota maior + 1", async () => {
    const song = await seedReadySong();
    await submit(song.id, perfect);
    await submit(song.id, { ...perfect, playerName: "BIA" });

    const middle = await submit(song.id, { playerName: "CAIO", track: detuneFrom(melody.track, 0.5, 3) });
    const worse = await submit(song.id, { playerName: "DUDA", track: silence(melody.track) });

    expect(middle.json().score).toBeLessThan(10);
    expect(worse.json().score).toBeLessThan(middle.json().score);
    // O rank é o da hora do envio: quem chega depois com nota menor fica atrás de todos.
    expect(middle.json().rank).toBe(3);
    expect(worse.json().rank).toBe(4);
  });

  it("persiste nota, offset, detalhes e a curva cantada", async () => {
    const song = await seedReadySong();
    const sung = detuneFrom(melody.track, 0.5, 3);

    const response = await submit(song.id, { playerName: "ANA", offsetMs: 300, track: sung });

    const stored = await prisma.performance.findUniqueOrThrow({ where: { id: response.json().id } });
    expect(stored).toMatchObject({
      songId: song.id,
      playerName: "ANA",
      score: response.json().score,
      pitchScore: response.json().pitchScore,
      timingScore: response.json().timingScore,
      offsetMs: 300,
    });
    expect(stored.details).toMatchObject({
      keyOffsetSemitones: response.json().keyOffsetSemitones,
      coverage: response.json().coverage,
    });
    expect((stored.sungTrack as PitchTrack).midi).toEqual(sung.midi);
  });

  // Na melodia sintética as frases vêm a cada ~3 s: uma letra 3 s fora ainda acharia a entrada
  // da frase seguinte na janela de ±800 ms da nota. 1,5 s cai no meio das frases.
  const LYRICS_LATE_MS = 1_500;

  it("a nota avalia a letra alinhada ao áudio, não a original (sdd-007)", async () => {
    // Letra do LRCLIB atrasada; o alinhamento gravado a colocou em cima da referência.
    const song = await seedReadySong({
      lyrics: shiftLines(melody.lines, LYRICS_LATE_MS),
      alignedLyrics: melody.lines,
      lyricsAlignment: { aligned: true, shiftMs: -LYRICS_LATE_MS, matchedRatio: 1 },
    });

    const response = await submit(song.id, perfect);

    expect(response.statusCode).toBe(201);
    expect(response.json().timingScore).toBeGreaterThanOrEqual(8);
    // `lines[].startMs` é o da linha avaliada (a alinhada), não o do LRC original (risco R6).
    expect(response.json().lines.map((line: { startMs: number }) => line.startMs)).toEqual(
      melody.lines.map((line) => line.startMs),
    );
  });

  it("sem alinhamento, a mesma cantoria com a letra fora do tempo perde na nota de tempo", async () => {
    const song = await seedReadySong({
      lyrics: shiftLines(melody.lines, LYRICS_LATE_MS),
      alignedLyrics: Prisma.DbNull,
      lyricsAlignment: { aligned: false, shiftMs: 0, matchedRatio: 0 },
    });

    const response = await submit(song.id, perfect);

    expect(response.statusCode).toBe(201);
    expect(response.json().timingScore).toBeLessThan(5);
    expect(response.json().pitchScore).toBe(10); // a afinação não depende da letra
  });

  it("nunca devolve sungTrack nem a referência na resposta", async () => {
    const song = await seedReadySong();

    const response = await submit(song.id, perfect);

    expect(response.json()).not.toHaveProperty("sungTrack");
    expect(response.json()).not.toHaveProperty("referenceTrack");
    expect(response.json()).not.toHaveProperty("track");
  });

  it("offsetMs é opcional (padrão 0) e o nome é normalizado com trim", async () => {
    const song = await seedReadySong();

    const response = await submit(song.id, { playerName: "  ANA  ", track: melody.track });

    expect(response.statusCode).toBe(201);
    expect(response.json().playerName).toBe("ANA");
    const stored = await prisma.performance.findFirstOrThrow();
    expect(stored.offsetMs).toBe(0);
  });

  it.each(["NONE", "PROCESSING", "FAILED"] as const)("referência %s → 409", async (status) => {
    const song = await seedSong({ referenceStatus: status, referenceUpdatedAt: new Date() });

    const response = await submit(song.id, perfect);

    expect(response.statusCode).toBe(409);
    expect(await prisma.performance.count()).toBe(0);
  });

  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["com HTML", "<script>alert(1)</script>"],
    ["com mais de 20 caracteres", "A".repeat(21)],
    ["com quebra de linha", "ANA\nBIA"],
  ])("playerName %s → 400", async (_label, playerName) => {
    const song = await seedReadySong();

    const response = await submit(song.id, { ...perfect, playerName });

    expect(response.statusCode).toBe(400);
  });

  it("aceita nomes com acento, número, ponto, sublinhado e hífen", async () => {
    const song = await seedReadySong();

    const response = await submit(song.id, { ...perfect, playerName: "Zé_do.Rock-2" });

    expect(response.statusCode).toBe(201);
  });

  it.each([
    ["hopMs diferente de 10", { ...melody.track, hopMs: 20 }],
    ["version diferente de 1", { ...melody.track, version: 2 }],
    ["midi vazio", { ...melody.track, midi: [] }],
    ["nota fora da faixa", { ...melody.track, midi: [200] }],
  ])("track com %s → 400", async (_label, track) => {
    const song = await seedReadySong();

    const response = await submit(song.id, { ...perfect, track });

    expect(response.statusCode).toBe(400);
  });

  it("offsetMs fora de ±10000 → 400", async () => {
    const song = await seedReadySong();

    const response = await submit(song.id, { ...perfect, offsetMs: 10_001 });

    expect(response.statusCode).toBe(400);
  });

  it("música inexistente → 404", async () => {
    const response = await submit("019a0000-0000-7000-8000-000000000000", perfect);

    expect(response.statusCode).toBe(404);
  });
});
