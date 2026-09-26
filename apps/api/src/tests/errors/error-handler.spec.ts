import fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "../../utils/error-handler.js";
import { AppError, LyricsProviderUnavailableError, SongWithoutSyncedLyricsError, YoutubeSearchUnavailableError } from "../../utils/errors.js";

const server = fastify({ logger: false });

server.setErrorHandler(errorHandler);
server.get("/with-code", async () => {
  throw new AppError("Não achei", 404, "NOT_FOUND_CODE");
});
server.get("/without-code", async () => {
  throw new AppError("Sem código", 409);
});
server.get("/search-failed", async () => {
  throw new YoutubeSearchUnavailableError();
});
server.get("/lyrics-unavailable", async () => {
  throw new LyricsProviderUnavailableError();
});
server.get("/no-synced", async () => {
  throw new SongWithoutSyncedLyricsError(77);
});
server.get("/boom", async () => {
  throw new Error("inesperado");
});
server.post("/small", { bodyLimit: 16 }, async () => ({ ok: true }));

beforeAll(() => server.ready());
afterAll(() => server.close());

describe("errorHandler", () => {
  it("AppError com code responde { message, code }", async () => {
    const response = await server.inject({ method: "GET", url: "/with-code" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Não achei", code: "NOT_FOUND_CODE" });
  });

  it("AppError sem code responde só { message } (contrato atual do /api/auth)", async () => {
    const response = await server.inject({ method: "GET", url: "/without-code" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "Sem código" });
  });

  it("YoutubeSearchUnavailableError responde 502 { message, code: SEARCH_FAILED } (sdd-008)", async () => {
    const response = await server.inject({ method: "GET", url: "/search-failed" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ message: "YouTube search is unavailable", code: "SEARCH_FAILED" });
  });

  it("LyricsProviderUnavailableError responde 502 com code LYRICS_UNAVAILABLE (sdd-015)", async () => {
    const response = await server.inject({ method: "GET", url: "/lyrics-unavailable" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ message: "Lyrics provider is unavailable", code: "LYRICS_UNAVAILABLE" });
  });

  it("SongWithoutSyncedLyricsError responde 422 com code NO_SYNCED_LYRICS (sdd-015)", async () => {
    const response = await server.inject({ method: "GET", url: "/no-synced" });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("NO_SYNCED_LYRICS");
  });

  it("corpo acima do bodyLimit responde 413, não 500", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/small",
      payload: { texto: "x".repeat(100) },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toHaveProperty("message");
  });

  it("JSON inválido responde 400", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/small",
      headers: { "content-type": "application/json" },
      payload: "{nope",
    });

    expect(response.statusCode).toBe(400);
  });

  it("erro inesperado responde 500 sem vazar a mensagem", async () => {
    const response = await server.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: "Internal server error" });
  });
});
