import { describe, expect, it } from "vitest";
import {
  DEFAULT_SINGER_VOLUME,
  SINGER_MAX,
  SINGER_MIN,
  STEMS_DURATION_TOLERANCE_MS,
  normalizeSingerVolume,
  singerGain,
  stemsMatchOriginal,
} from "../lib/singer-volume";

describe("normalizeSingerVolume", () => {
  it("arredonda ao passo de 5", () => {
    expect(normalizeSingerVolume(42)).toBe(40);
    expect(normalizeSingerVolume(43)).toBe(45);
  });

  it("limita a 0–100 e trata NaN como o padrão (50)", () => {
    expect(normalizeSingerVolume(250)).toBe(SINGER_MAX);
    expect(normalizeSingerVolume(-10)).toBe(SINGER_MIN);
    expect(normalizeSingerVolume(Number.NaN)).toBe(DEFAULT_SINGER_VOLUME);
    expect(DEFAULT_SINGER_VOLUME).toBe(50);
  });
});

describe("singerGain", () => {
  it("converte o volume em ganho de 0 a 1: 100 % é o original, 0 % só o instrumental", () => {
    expect(singerGain(0)).toBe(0);
    expect(singerGain(50)).toBeCloseTo(0.5);
    expect(singerGain(100)).toBe(1);
  });
});

describe("stemsMatchOriginal", () => {
  it("aceita as trilhas na duração do original, com tolerância de 100 ms", () => {
    expect(stemsMatchOriginal(213_000, 213_000, 213_000)).toBe(true);
    expect(stemsMatchOriginal(213_000 + STEMS_DURATION_TOLERANCE_MS, 213_000 - STEMS_DURATION_TOLERANCE_MS, 213_000)).toBe(true);
  });

  it("recusa quando qualquer trilha diverge mais que a tolerância", () => {
    expect(stemsMatchOriginal(213_101, 213_000, 213_000)).toBe(false);
    expect(stemsMatchOriginal(213_000, 212_899, 213_000)).toBe(false);
  });
});
