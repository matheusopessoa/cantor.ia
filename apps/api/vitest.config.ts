import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

// Carregado explicitamente, e não pelo dotenv do env.ts, para que a suíte nunca
// herde por acidente o DATABASE_URL de desenvolvimento.
const testEnv = parse(
  readFileSync(fileURLToPath(new URL(".env.test", import.meta.url))),
);

// O globalSetup roda no processo do Vitest, fora do alcance de `test.env`.
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    // Restrito ao src para que o build compilado em dist/ nunca seja coletado
    // como suíte de testes.
    include: ["src/**/*.{test,spec}.ts"],
    globalSetup: ["src/tests/global-setup.ts"],
    setupFiles: ["src/tests/setup.ts"],
    // Os arquivos compartilham um único banco: em paralelo, o TRUNCATE de um
    // apagaria os dados que outro acabou de inserir.
    fileParallelism: false,
    env: testEnv,
  },
});
