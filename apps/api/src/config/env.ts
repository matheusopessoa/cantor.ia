import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { InvalidEnvironmentError } from "../utils/errors.js";

// Na suíte, o ambiente vem só do apps/api/.env.test (vitest.config.ts): nenhum valor de dev
// pode vazar para os testes.
if (process.env["NODE_ENV"] !== "test") {
  config({
    // src/config → raiz do repo (a mesma profundidade vale para dist/config).
    path: fileURLToPath(new URL("../../../../.env", import.meta.url)),
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
