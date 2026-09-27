import { describe, expect, it } from "vitest";
import { combinedProgress } from "../lib/download-progress";
import { separatedStemsValid, storedStemsValid, type SongStems } from "../lib/stems-store";

const blob = new Blob(["x"]);

function stems(extra: Partial<SongStems>): SongStems {
  return { vocals: blob, instrumental: blob, ...extra };
}

describe("storedStemsValid (sdd-016)", () => {
  it("vale só com a mesma stemsKey", () => {
    expect(storedStemsValid(stems({ stemsKey: "k1" }), "k1")).toBe(true);
    expect(storedStemsValid(stems({ stemsKey: "k1" }), "k2")).toBe(false);
  });

  it("sem cache, ou registro do fallback (sourceSize), não vale", () => {
    expect(storedStemsValid(null, "k1")).toBe(false);
    expect(storedStemsValid(stems({ sourceSize: 123 }), "k1")).toBe(false);
  });
});

describe("separatedStemsValid (sdd-013)", () => {
  it("vale só com o mesmo sourceSize e sem stemsKey", () => {
    expect(separatedStemsValid(stems({ sourceSize: 123 }), 123)).toBe(true);
    expect(separatedStemsValid(stems({ sourceSize: 123 }), 124)).toBe(false);
    expect(separatedStemsValid(stems({ stemsKey: "k1", sourceSize: 123 }), 123)).toBe(false);
    expect(separatedStemsValid(null, 123)).toBe(false);
  });
});

describe("combinedProgress (sdd-016)", () => {
  it("soma o carregado e só informa o total quando todos os downloads têm o deles", () => {
    const reports: [number, number | null][] = [];
    const [a, b] = combinedProgress(2, (loaded, total) => reports.push([loaded, total]));

    a(0, 100);
    b(0, null);
    a(50, 100);
    b(30, 200);
    b(200, 200);

    expect(reports).toEqual([
      [0, null],
      [0, null],
      [50, null],
      [80, 300],
      [250, 300],
    ]);
  });

  it("sem onProgress não quebra", () => {
    const [only] = combinedProgress(1);
    expect(() => only(10, 10)).not.toThrow();
  });
});
