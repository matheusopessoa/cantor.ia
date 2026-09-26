import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";
import { envSchema } from "../../config/env.js";

const validEnv = {
  NODE_ENV: "dev",
  DATABASE_URL: "postgresql://cantor:cantor@localhost:5432/cantor_dev?schema=public",
  JWT_SIGN_SECRET: "a".repeat(32),
  EMAIL_BINDEX_SECRET: "b".repeat(32),
};

function issuePaths(input: Record<string, unknown>): string[] {
  const result = envSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("envSchema", () => {
  it("lista no .env.example da raiz todas as variáveis da API", () => {
    const example = parse(
      readFileSync(fileURLToPath(new URL("../../../../../.env.example", import.meta.url))),
    );
    // NODE_ENV é definido por processo, nunca no .env compartilhado.
    const keys = Object.keys(envSchema.shape).filter((key) => key !== "NODE_ENV");

    expect(keys.filter((key) => !(key in example))).toEqual([]);
  });

  it("aceita um ambiente de dev válido sem CORS_ALLOWED_ORIGINS", () => {
    const result = envSchema.safeParse(validEnv);

    expect(result.success).toBe(true);
    expect(result.data?.CORS_ALLOWED_ORIGINS).toEqual([]);
  });

  it("recusa segredos com menos de 32 caracteres", () => {
    expect(issuePaths({ ...validEnv, JWT_SIGN_SECRET: "curto" })).toEqual(["JWT_SIGN_SECRET"]);
    expect(issuePaths({ ...validEnv, EMAIL_BINDEX_SECRET: "curto" })).toEqual([
      "EMAIL_BINDEX_SECRET",
    ]);
  });

  it("exige as variáveis obrigatórias", () => {
    expect(issuePaths({ NODE_ENV: "dev" }).sort()).toEqual([
      "DATABASE_URL",
      "EMAIL_BINDEX_SECRET",
      "JWT_SIGN_SECRET",
    ]);
  });

  it("recusa DATABASE_URL que não seja postgres", () => {
    expect(issuePaths({ ...validEnv, DATABASE_URL: "http://localhost:5432/cantor" })).toEqual([
      "DATABASE_URL",
    ]);
  });

  it("exige CORS_ALLOWED_ORIGINS em prod", () => {
    expect(issuePaths({ ...validEnv, NODE_ENV: "prod" })).toEqual(["CORS_ALLOWED_ORIGINS"]);
  });

  it("converte CORS_ALLOWED_ORIGINS em lista e valida cada origem", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      NODE_ENV: "prod",
      CORS_ALLOWED_ORIGINS: "https://a.dev, https://b.dev",
    });

    expect(result.data?.CORS_ALLOWED_ORIGINS).toEqual(["https://a.dev", "https://b.dev"]);
    expect(issuePaths({ ...validEnv, CORS_ALLOWED_ORIGINS: "https://a.dev,nao-e-url" })).toEqual([
      "CORS_ALLOWED_ORIGINS.1",
    ]);
  });
});
