import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Só os testes das funções puras e do cliente HTTP com `fetch` falso: nada sobe a API.
    include: ["tests/**/*.spec.ts"],
  },
});
