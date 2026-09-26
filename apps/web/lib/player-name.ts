/** Mesma regra de `playerNameSchema` (`apps/api/src/utils/validators.ts`). */
export const PLAYER_NAME_MAX = 20;
export const PLAYER_NAME_REGEX = /^[\p{L}\p{N} ._-]+$/u;

export const PLAYER_NAME_HINT = "Use só letras, números, espaço, ponto, _ ou -.";

/** Normaliza como a API faz (`trim`) antes de validar e de enviar. */
export function normalizePlayerName(raw: string): string {
  return raw.trim();
}

/** `null` quando o nome é válido; senão a mensagem para o campo. */
export function playerNameError(raw: string): string | null {
  const name = normalizePlayerName(raw);
  if (name.length === 0) return "Digite um nome para entrar no ranking.";
  if (name.length > PLAYER_NAME_MAX) return `No máximo ${PLAYER_NAME_MAX} caracteres.`;
  if (!PLAYER_NAME_REGEX.test(name)) return PLAYER_NAME_HINT;
  return null;
}

export function isValidPlayerName(raw: string): boolean {
  return playerNameError(raw) === null;
}

const STORAGE_KEY = "cantor.ia:player-name";

/** Último nome usado neste dispositivo. `null` sem `localStorage` (aba anônima etc.). */
export function loadPlayerName(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value !== null && isValidPlayerName(value) ? normalizePlayerName(value) : null;
  } catch {
    return null;
  }
}

export function savePlayerName(name: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, normalizePlayerName(name));
  } catch {
    // sem storage: o nome vale só nesta sessão
  }
}
