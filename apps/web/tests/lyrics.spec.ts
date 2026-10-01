import { describe, expect, it } from "vitest";
import { currentLineIndex, effectiveLyrics, lineProgress } from "../lib/lyrics";
import type { LyricLine } from "../lib/types";

const lines: LyricLine[] = [
  { startMs: 1000, text: "primeira" },
  { startMs: 3000, text: "segunda" },
  { startMs: 6000, text: "terceira" },
];

describe("currentLineIndex", () => {
  it("é -1 antes da primeira linha", () => {
    expect(currentLineIndex(lines, 0)).toBe(-1);
    expect(currentLineIndex(lines, 999)).toBe(-1);
  });

  it("entra na linha exatamente no startMs", () => {
    expect(currentLineIndex(lines, 1000)).toBe(0);
    expect(currentLineIndex(lines, 3000)).toBe(1);
  });

  it("acha a linha no meio da música", () => {
    expect(currentLineIndex(lines, 4500)).toBe(1);
  });

  it("fica na última linha depois dela", () => {
    expect(currentLineIndex(lines, 60_000)).toBe(2);
  });

  it("offset positivo adianta a letra (linha entra antes)", () => {
    expect(currentLineIndex(lines, 2600, 500)).toBe(1);
    expect(currentLineIndex(lines, 2400, 500)).toBe(0);
  });

  it("offset negativo atrasa a letra (linha entra depois)", () => {
    expect(currentLineIndex(lines, 3200, -500)).toBe(0);
    expect(currentLineIndex(lines, 3500, -500)).toBe(1);
  });

  it("lista vazia é -1", () => {
    expect(currentLineIndex([], 1000)).toBe(-1);
  });
});

describe("lineProgress", () => {
  it("vai de 0 a 1 entre o início da linha e o da próxima", () => {
    expect(lineProgress(lines, 0, 1000)).toBe(0);
    expect(lineProgress(lines, 0, 2000)).toBeCloseTo(0.5, 6);
    expect(lineProgress(lines, 0, 3000)).toBe(1);
  });

  it("fica limitado a [0, 1]", () => {
    expect(lineProgress(lines, 1, 0)).toBe(0);
    expect(lineProgress(lines, 1, 99_000)).toBe(1);
  });

  it("última linha dura 5 s", () => {
    expect(lineProgress(lines, 2, 8500)).toBeCloseTo(0.5, 6);
  });

  it("respeita o offset", () => {
    expect(lineProgress(lines, 0, 1500, 500)).toBeCloseTo(0.5, 6);
  });

  it("índice inválido é 0", () => {
    expect(lineProgress(lines, -1, 2000)).toBe(0);
    expect(lineProgress(lines, 3, 2000)).toBe(0);
  });
});

describe("effectiveLyrics", () => {
  const aligned: LyricLine[] = lines.map((line) => ({ ...line, startMs: line.startMs + 3000 }));

  it("usa a letra alinhada quando a API conseguiu alinhar", () => {
    expect(effectiveLyrics({ lyrics: lines, alignedLyrics: aligned })).toBe(aligned);
  });

  it("cai na letra original quando não há alinhamento", () => {
    expect(effectiveLyrics({ lyrics: lines, alignedLyrics: null })).toBe(lines);
  });
});
