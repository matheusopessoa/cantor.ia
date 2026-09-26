import { describe, expect, it } from "vitest";
import { formatDuration, formatElapsed, formatOffset, formatOrdinal, formatScore } from "../lib/format";
import { gradeForScore } from "../lib/grade";
import { normalizeOffsetMs } from "../lib/lyrics-offset";

describe("formatDuration", () => {
  it("m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(272_400)).toBe("4:32");
    expect(formatDuration(3_600_000)).toBe("60:00");
  });

  it("negativo e NaN viram 0:00", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});

describe("formatElapsed", () => {
  it("mm:ss", () => {
    expect(formatElapsed(84_000)).toBe("01:24");
    expect(formatElapsed(0)).toBe("00:00");
  });
});

describe("formatScore", () => {
  it("uma casa decimal", () => {
    expect(formatScore(8.44)).toBe("8.4");
    expect(formatScore(10)).toBe("10.0");
    expect(formatScore(0)).toBe("0.0");
  });
});

describe("formatOffset", () => {
  it("segundos com sinal", () => {
    expect(formatOffset(0)).toBe("+0.0s");
    expect(formatOffset(500)).toBe("+0.5s");
    expect(formatOffset(-1200)).toBe("-1.2s");
  });
});

describe("formatOrdinal", () => {
  it("1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 111th", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(formatOrdinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "111th",
    ]);
  });
});

describe("gradeForScore", () => {
  it("S ≥ 9.0 · A ≥ 7.0 · B ≥ 5.0 · C ≥ 3.0 · D", () => {
    expect(gradeForScore(10)).toBe("S");
    expect(gradeForScore(9)).toBe("S");
    expect(gradeForScore(8.9)).toBe("A");
    expect(gradeForScore(7)).toBe("A");
    expect(gradeForScore(6.9)).toBe("B");
    expect(gradeForScore(5)).toBe("B");
    expect(gradeForScore(4.9)).toBe("C");
    expect(gradeForScore(3)).toBe("C");
    expect(gradeForScore(2.9)).toBe("D");
    expect(gradeForScore(0)).toBe("D");
  });
});

describe("normalizeOffsetMs", () => {
  it("arredonda ao passo de 100 ms e limita a ±10 s", () => {
    expect(normalizeOffsetMs(0)).toBe(0);
    expect(normalizeOffsetMs(149)).toBe(100);
    expect(normalizeOffsetMs(150)).toBe(200);
    expect(normalizeOffsetMs(-2600)).toBe(-2600);
    expect(normalizeOffsetMs(-12_600)).toBe(-10_000);
    expect(normalizeOffsetMs(99_999)).toBe(10_000);
    expect(normalizeOffsetMs(Number.NaN)).toBe(0);
  });
});
