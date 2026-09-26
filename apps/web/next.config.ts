import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// O .env é único, na raiz do monorepo, e o Next só procura .env dentro de apps/web. Copiamos
// apenas as chaves do web: os segredos da API nunca entram no processo do Next.
const WEB_ENV_KEYS = ["NEXT_PUBLIC_API_URL", "API_INTERNAL_URL"] as const;

const rootEnvPath = path.join(__dirname, "../../.env");

if (existsSync(rootEnvPath)) {
  const rootEnv = parseEnv(readFileSync(rootEnvPath, "utf8"));

  for (const key of WEB_ENV_KEYS) {
    const value = rootEnv[key];
    if (process.env[key] === undefined && value !== undefined) {
      process.env[key] = value;
    }
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  // Num workspace pnpm as dependências reais vivem em <raiz>/node_modules/.pnpm
  // e apps/web/node_modules é só uma árvore de symlinks. Sem ampliar o tracing
  // para a raiz, o standalone sai sem elas.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
