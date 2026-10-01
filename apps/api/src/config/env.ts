import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { InvalidEnvironmentError } from "../utils/errors.js";

// src/config → raiz do repo (a mesma profundidade vale para dist/config).
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

// Na suíte, o ambiente vem só do apps/api/.env.test (vitest.config.ts): nenhum valor de dev
// pode vazar para os testes.
if (process.env["NODE_ENV"] !== "test") {
  config({
    path: resolve(REPO_ROOT, ".env"),
    quiet: true,
  });
}

const secretSchema = z.string().min(32);

const originListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["dev", "test", "prod"]).default("dev"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    JWT_SIGN_SECRET: secretSchema,
    EMAIL_BINDEX_SECRET: secretSchema,
    CORS_ALLOWED_ORIGINS: originListSchema.default([]),
    // Endereço do worker de pitch (apps/worker). Entre containers vira http://worker:8000.
    WORKER_URL: z.url().default("http://localhost:8000"),
    // Provedor de letras sincronizadas (LRCLIB). Só muda para apontar a um espelho.
    LRCLIB_BASE_URL: z.url().default("https://lrclib.net"),
    // Token de serviço das rotas /api/review/* (revisão da letra pelo MCP, sdd-012). Opcional:
    // sem ela (ou vazia, como o compose passa quando não está no .env), a revisão fica desligada.
    LYRICS_REVIEW_SECRET: z.preprocess((value) => (value === "" ? undefined : value), secretSchema.optional()),
    // Pasta local das trilhas (voz e instrumental) das referências prontas (sdd-016). Relativa
    // à raiz do repo; no compose é um volume. Sempre absoluta depois de validada.
    SONG_STEMS_DIR: z
      .string()
      .min(1)
      .default(".data/stems")
      .transform((value) => resolve(REPO_ROOT, value)),
  })
  .refine((env) => env.NODE_ENV !== "prod" || env.CORS_ALLOWED_ORIGINS.length > 0, {
    path: ["CORS_ALLOWED_ORIGINS"],
    message: "obrigatória quando NODE_ENV=prod",
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new InvalidEnvironmentError(z.flattenError(parsed.error).fieldErrors);
}

export const env = parsed.data;

export type Env = typeof env;
export type NodeEnv = Env["NODE_ENV"];
