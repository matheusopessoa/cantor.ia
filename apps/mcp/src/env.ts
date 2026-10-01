import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { z } from "zod";

/**
 * O MCP lê as mesmas variáveis do `.env` da raiz que a API e o web (AGENTS.md §11): o endereço
 * da API e o token de serviço das rotas `/api/review/*` (sdd-012).
 */
export const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
  LYRICS_REVIEW_SECRET: z.string().min(32),
});
export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

/** Valida o ambiente. Falta ou valor inválido → `EnvError` com o nome da variável e o que fazer. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const variables = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ");
  throw new EnvError(
    `Variável de ambiente ausente ou inválida no .env da raiz: ${variables}. ` +
      "NEXT_PUBLIC_API_URL precisa ser a URL da API e LYRICS_REVIEW_SECRET um segredo com pelo menos 32 caracteres " +
      "(o mesmo da API; `pnpm env:init` gera um, ou use `openssl rand -hex 32`).",
  );
}

/** Caminho do `.env` da raiz: `apps/mcp/src` (ou `dist`) → raiz do repositório. */
export function rootEnvPath(): string {
  return fileURLToPath(new URL("../../../.env", import.meta.url));
}

/** Lê o `.env` da raiz (quando existe) e deixa o ambiente do processo prevalecer. */
export function loadEnv(): Env {
  let fromFile: Record<string, string> = {};
  try {
    fromFile = parse(readFileSync(rootEnvPath()));
  } catch {
    // Sem .env: só o que veio no ambiente do processo (ex.: `env` no .mcp.json).
  }
  return parseEnv({ ...fromFile, ...process.env });
}
