import type { Difficulty } from "./types";

/** Ordem das abas "Fácil | Médio | Difícil" (sdd-009). */
export const DIFFICULTIES: readonly Difficulty[] = ["EASY", "MEDIUM", "HARD"];

/**
 * Nível para quem nunca escolheu (sdd-009, regra 9). É diferente do padrão da API (`HARD`,
 * compatibilidade com clientes antigos): o web sempre manda o nível explicitamente.
 */
export const DEFAULT_DIFFICULTY: Difficulty = "MEDIUM";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: "Fácil",
  MEDIUM: "Médio",
  HARD: "Difícil",
};

/** Copy dos níveis, como no readme do design system ("Voz e texto"). */
export const DIFFICULTY_DESCRIPTION: Record<Difficulty, string> = {
  EASY: "Só letra no tempo e ritmo, sem afinação.",
  MEDIUM: "Afinação com folga de um semitom.",
  HARD: "Afinação de meio semitom.",
};

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);
}

const STORAGE_KEY = "cantor.ia:difficulty";

/** Nível memorizado neste dispositivo; `DEFAULT_DIFFICULTY` sem `localStorage` ou sem escolha. */
export function loadDifficulty(): Difficulty {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isDifficulty(raw) ? raw : DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

export function saveDifficulty(difficulty: Difficulty): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, difficulty);
  } catch {
    // sem storage: o nível vale só nesta sessão
  }
}
