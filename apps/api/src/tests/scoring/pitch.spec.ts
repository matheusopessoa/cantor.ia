import { describe, it, expect } from "vitest";
import { findOnset, fold12, median } from "../../utils/pitch.js";

describe("fold12", () => {
  it("mantém diferenças pequenas", () => {
    expect(fold12(0)).toBe(0);
    expect(fold12(2.5)).toBe(2.5);
    expect(fold12(-0.5)).toBe(-0.5);
    expect(fold12(5.9)).toBeCloseTo(5.9, 10);
  });

  it("zera oitavas inteiras", () => {
    expect(fold12(12)).toBe(0);
    expect(fold12(-12)).toBe(0);
    expect(fold12(24)).toBe(0);
  });

  it("devolve sempre um valor em [-6, 6)", () => {
    expect(fold12(6)).toBe(-6);
    expect(fold12(-6)).toBe(-6);
    expect(fold12(18)).toBe(-6);
    expect(fold12(13.5)).toBeCloseTo(1.5, 10);
    expect(fold12(-13.5)).toBeCloseTo(-1.5, 10);
    expect(fold12(-7)).toBe(5);
  });
});

describe("median", () => {
  it("quantidade ímpar devolve o valor central", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("quantidade par devolve a média dos dois centrais", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("lista vazia devolve 0", () => {
    expect(median([])).toBe(0);
  });

  it("não altera o array recebido", () => {
    const values = [9, 1, 5];
    median(values);
    expect(values).toEqual([9, 1, 5]);
  });
});

describe("findOnset", () => {
  const silent = new Array<number | null>(100).fill(null);

  function withVoice(from: number, to: number, base: (number | null)[] = silent): (number | null)[] {
    return base.map((value, i) => (i >= from && i < to ? 60 : value));
  }

  it("sem voz devolve null", () => {
    expect(findOnset(silent, 0, 99, 5)).toBeNull();
  });

  it("voz mais curta que minRun não conta", () => {
    expect(findOnset(withVoice(20, 23), 0, 99, 5)).toBeNull();
  });

  it("encontra o frame exato do onset", () => {
    expect(findOnset(withVoice(20, 60), 0, 99, 5)).toBe(20);
  });

  it("aceita onset cujo trecho continua além do fim da janela", () => {
    expect(findOnset(withVoice(48, 60), 0, 50, 5)).toBe(48);
  });

  it("ignora voz que já vinha soando antes da janela", () => {
    expect(findOnset(withVoice(10, 60), 30, 70, 5)).toBeNull();
  });

  it("voz que começa no frame 0 conta como onset", () => {
    expect(findOnset(withVoice(0, 60), 0, 50, 5)).toBe(0);
  });

  it("devolve o primeiro de vários onsets", () => {
    const track = withVoice(70, 90, withVoice(30, 40));
    expect(findOnset(track, 0, 99, 5)).toBe(30);
  });

  it("tolera janela fora dos limites do track", () => {
    expect(findOnset(withVoice(2, 30), -50, 500, 5)).toBe(2);
    expect(findOnset(withVoice(2, 30), 200, 300, 5)).toBeNull();
  });
});
