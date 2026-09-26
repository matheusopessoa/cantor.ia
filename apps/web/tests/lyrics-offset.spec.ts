import { describe, expect, it } from "vitest";
import { OFFSET_MAX_MS, OFFSET_MIN_MS, normalizeOffsetMs, offsetStorageKey } from "../lib/lyrics-offset";

describe("normalizeOffsetMs", () => {
  it("arredonda ao passo de 100 ms", () => {
    expect(normalizeOffsetMs(149)).toBe(100);
    expect(normalizeOffsetMs(150)).toBe(200);
    expect(normalizeOffsetMs(-149)).toBe(-100);
  });

  it("limita à faixa da API e trata NaN como 0", () => {
    expect(normalizeOffsetMs(99_999)).toBe(OFFSET_MAX_MS);
    expect(normalizeOffsetMs(-99_999)).toBe(OFFSET_MIN_MS);
    expect(normalizeOffsetMs(Number.NaN)).toBe(0);
  });
});

describe("offsetStorageKey", () => {
  it("separa o ajuste da letra original do da letra alinhada", () => {
    expect(offsetStorageKey("abc", false)).not.toBe(offsetStorageKey("abc", true));
    expect(offsetStorageKey("abc", true)).toMatch(/aligned$/);
  });

  it("separa por música", () => {
    expect(offsetStorageKey("abc", true)).not.toBe(offsetStorageKey("xyz", true));
  });

  it("mantém a chave antiga para a letra original (ajustes já guardados continuam valendo)", () => {
    expect(offsetStorageKey("abc", false)).toBe("cantor.ia:offset:abc");
  });
});
