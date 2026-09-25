import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { InvalidEnvironmentError } from "../utils/errors.js";

config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

const envSchema = z.object({
  NODE_ENV: z.enum(["dev", "test", "prod"]).default("dev"),

  JWT_SIGN_SECRET: z.string().min(1),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("https://prod.domain")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new InvalidEnvironmentError(z.flattenError(parsed.error).fieldErrors);
}

export const env = parsed.data;

export type Env = typeof env;
export type NodeEnv = Env["NODE_ENV"];
