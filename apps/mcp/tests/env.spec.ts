import { describe, expect, it } from "vitest";
import { EnvError, parseEnv, rootEnvPath } from "../src/env.js";

const SECRET = "x".repeat(32);

describe("parseEnv", () => {
  it("aceita URL da API e segredo de 32+ caracteres, ignorando o resto do .env", () => {
    const env = parseEnv({ NEXT_PUBLIC_API_URL: "http://localhost:3333", LYRICS_REVIEW_SECRET: SECRET, DATABASE_URL: "postgres://x" });

    expect(env).toEqual({ NEXT_PUBLIC_API_URL: "http://localhost:3333", LYRICS_REVIEW_SECRET: SECRET });
  });

  it("variável ausente → erro claro com o nome dela e o que fazer", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_API_URL: "http://localhost:3333" })).toThrow(EnvError);
    expect(() => parseEnv({ NEXT_PUBLIC_API_URL: "http://localhost:3333" })).toThrow(/LYRICS_REVIEW_SECRET.*pnpm env:init/s);
    expect(() => parseEnv({})).toThrow(/NEXT_PUBLIC_API_URL, LYRICS_REVIEW_SECRET/);
  });

  it("segredo curto ou URL inválida → erro", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_API_URL: "http://localhost:3333", LYRICS_REVIEW_SECRET: "curto" })).toThrow(/LYRICS_REVIEW_SECRET/);
    expect(() => parseEnv({ NEXT_PUBLIC_API_URL: "localhost", LYRICS_REVIEW_SECRET: SECRET })).toThrow(/NEXT_PUBLIC_API_URL/);
  });
});

describe("rootEnvPath", () => {
  it("aponta para o .env da raiz do repositório", () => {
    expect(rootEnvPath()).toMatch(/\/cantor\.ia\/\.env$/);
  });
});
