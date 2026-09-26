import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// Não sobrescreve o que já está no processo: a suíte de testes passa o DATABASE_URL de teste
// pelo ambiente ao rodar `prisma migrate deploy`.
config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
