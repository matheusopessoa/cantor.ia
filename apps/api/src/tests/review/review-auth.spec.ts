import fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../app.js";
import { errorHandler } from "../../utils/error-handler.js";
import { bearerToken, reviewAuth, safeEqual } from "../../utils/review-auth.js";

const SECRET = "a-secret-with-at-least-thirty-two-characters";

const withSecret = fastify({ logger: false });
withSecret.setErrorHandler(errorHandler);
withSecret.addHook("onRequest", reviewAuth(SECRET));
withSecret.get("/", async () => ({ ok: true }));

const disabled = fastify({ logger: false });
disabled.setErrorHandler(errorHandler);
disabled.addHook("onRequest", reviewAuth(undefined));
disabled.get("/", async () => ({ ok: true }));

beforeAll(async () => {
  await withSecret.ready();
  await disabled.ready();
});
afterAll(async () => {
  await withSecret.close();
  await disabled.close();
});

describe("reviewAuth", () => {
  it("sem header → 401 UNAUTHORIZED, sem vazar o segredo", async () => {
    const response = await withSecret.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Missing or invalid review token", code: "UNAUTHORIZED" });
    expect(response.body).not.toContain(SECRET);
  });

  it.each([`Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, SECRET, `Basic ${SECRET}`, "Bearer "])(
    "token errado (%s) → 401",
    async (authorization) => {
      const response = await withSecret.inject({ method: "GET", url: "/", headers: { authorization } });

      expect(response.statusCode).toBe(401);
    },
  );

  it("token certo → passa", async () => {
    const response = await withSecret.inject({ method: "GET", url: "/", headers: { authorization: `Bearer ${SECRET}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("aceita 'bearer' em minúsculas e espaços a mais", async () => {
    const response = await withSecret.inject({ method: "GET", url: "/", headers: { authorization: `bearer   ${SECRET}  ` } });

    expect(response.statusCode).toBe(200);
  });

  it("sem LYRICS_REVIEW_SECRET no servidor → 503 REVIEW_DISABLED mesmo com token", async () => {
    const response = await disabled.inject({ method: "GET", url: "/", headers: { authorization: `Bearer ${SECRET}` } });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "REVIEW_DISABLED" });
  });
});

describe("safeEqual / bearerToken", () => {
  it("compara textos de tamanhos diferentes sem lançar", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
  });

  it("extrai o token do header", () => {
    expect(bearerToken("Bearer xyz")).toBe("xyz");
    expect(bearerToken(["Bearer first", "Bearer second"])).toBe("first");
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Token xyz")).toBeNull();
  });
});

describe("/api/review/* no app", () => {
  it("toda rota exige o token; as rotas públicas seguem sem autenticação", async () => {
    const protectedRoutes = [
      { method: "GET" as const, url: "/api/review/songs" },
      { method: "GET" as const, url: "/api/review/songs/019a0000-0000-7000-8000-000000000000" },
      { method: "POST" as const, url: "/api/review/songs/019a0000-0000-7000-8000-000000000000/check" },
      { method: "POST" as const, url: "/api/review/songs/019a0000-0000-7000-8000-000000000000/apply" },
    ];
    for (const route of protectedRoutes) {
      const response = await app.inject({ ...route, payload: {} });
      expect(response.statusCode, route.url).toBe(401);
    }

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
  });
});
