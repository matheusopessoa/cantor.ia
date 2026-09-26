import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  DIFFICULTY_DESCRIPTION,
  DIFFICULTY_LABEL,
  isDifficulty,
  loadDifficulty,
  saveDifficulty,
} from "../lib/difficulty";

/** `localStorage` de mentira: o ambiente de teste é node, sem `window`. */
function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  (globalThis as { window?: unknown }).window = { localStorage };
  return store;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("níveis (sdd-009)", () => {
  it("são três, na ordem das abas, com rótulo e descrição em pt-BR", () => {
    expect(DIFFICULTIES).toEqual(["EASY", "MEDIUM", "HARD"]);
    for (const difficulty of DIFFICULTIES) {
      expect(DIFFICULTY_LABEL[difficulty].length).toBeGreaterThan(0);
      expect(DIFFICULTY_DESCRIPTION[difficulty].length).toBeGreaterThan(0);
    }
    expect(DIFFICULTY_LABEL).toEqual({ EASY: "Fácil", MEDIUM: "Médio", HARD: "Difícil" });
  });

  it("o padrão do web é Médio (o da API é HARD)", () => {
    expect(DEFAULT_DIFFICULTY).toBe("MEDIUM");
  });

  it("isDifficulty aceita só os três valores exatos", () => {
    expect(isDifficulty("EASY")).toBe(true);
    expect(isDifficulty("HARD")).toBe(true);
    expect(isDifficulty("easy")).toBe(false);
    expect(isDifficulty("EXPERT")).toBe(false);
    expect(isDifficulty(null)).toBe(false);
    expect(isDifficulty(1)).toBe(false);
  });
});

describe("loadDifficulty / saveDifficulty", () => {
  it("sem window (servidor) devolve o padrão", () => {
    expect(loadDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  it("sem escolha guardada devolve o padrão", () => {
    installStorage();
    expect(loadDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  it("guarda e lê o nível na chave cantor.ia:difficulty", () => {
    const store = installStorage();
    saveDifficulty("HARD");
    expect(store.get("cantor.ia:difficulty")).toBe("HARD");
    expect(loadDifficulty()).toBe("HARD");
  });

  it("valor inválido guardado cai no padrão", () => {
    installStorage({ "cantor.ia:difficulty": "expert" });
    expect(loadDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  it("não quebra quando o storage lança (aba anônima)", () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };
    expect(() => saveDifficulty("EASY")).not.toThrow();
    expect(loadDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });
});
