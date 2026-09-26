import { defineConfig } from "vitest/config";

// Só funções puras de lib/ (sem DOM, sem Next): ambiente node e nenhum plugin.
export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
    environment: "node",
  },
});
