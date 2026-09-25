import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Num workspace pnpm as dependências reais vivem em <raiz>/node_modules/.pnpm
  // e apps/web/node_modules é só uma árvore de symlinks. Sem ampliar o tracing
  // para a raiz, o standalone sai sem elas.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
