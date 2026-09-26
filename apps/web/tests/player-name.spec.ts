import { describe, expect, it } from "vitest";
import { isValidPlayerName, normalizePlayerName, playerNameError } from "../lib/player-name";

describe("playerNameError (espelha playerNameSchema da API)", () => {
  it("aceita letras, números, espaço, ponto, sublinhado e hífen, com acentos", () => {
    for (const name of ["ANA", "Jo ao", "math_01", "z.e-ta", "José", "Ñandu 7", "a"]) {
      expect(playerNameError(name)).toBeNull();
      expect(isValidPlayerName(name)).toBe(true);
    }
  });

  it("recusa vazio e só espaços", () => {
    expect(playerNameError("")).not.toBeNull();
    expect(playerNameError("   ")).not.toBeNull();
  });

  it("aceita 20 caracteres e recusa 21", () => {
    expect(playerNameError("a".repeat(20))).toBeNull();
    expect(playerNameError("a".repeat(21))).not.toBeNull();
  });

  it("recusa HTML e símbolos fora da lista", () => {
    for (const name of ["<script>", "ana@bar", "nome!", "a/b", "emoji 🎤"]) {
      expect(playerNameError(name)).not.toBeNull();
    }
  });

  it("faz trim antes de validar, como a API", () => {
    expect(normalizePlayerName("  ANA  ")).toBe("ANA");
    expect(playerNameError("  ANA  ")).toBeNull();
    expect(playerNameError(" " + "a".repeat(20) + " ")).toBeNull();
  });
});
