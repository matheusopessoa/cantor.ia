import { describe, expect, it } from "vitest";
import { ALIGNMENT_CONFIG, alignmentService } from "../../services/alignment.service.js";
import type { LyricLine } from "../../utils/validators.js";
import { delay, jitterLines, makeMelody, randomNotes, scaleLines, shiftLines, silence } from "../helpers/tracks.js";

const SONG_MS = 60_000;
const melody = makeMelody(42, SONG_MS);
const { track, lines } = melody;

/** Diferença máxima (ms) entre duas letras, só nas linhas que cabem no áudio. */
function maxError(actual: LyricLine[], expected: LyricLine[], durationMs: number): number {
  let worst = 0;
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i]?.startMs ?? 0;
    if (want > durationMs) continue; // caiu fora do áudio: não há onset para achar
    worst = Math.max(worst, Math.abs((actual[i]?.startMs ?? 0) - want));
  }
  return worst;
}

describe("alignmentService.align", () => {
  it("letra já em cima da referência não muda (shift 0, todas encaixadas)", () => {
    const result = alignmentService.align(lines, track);

    expect(result).toEqual({ aligned: true, shiftMs: 0, matchedRatio: 1, lines });
  });

  it.each([
    ["+3 s", shiftLines(lines, 3_000), track, lines, -3_000],
    ["+9 s", shiftLines(lines, 9_000), track, lines, -9_000],
    ["−1,5 s (áudio com intro mais longa)", lines, delay(track, 1_500), shiftLines(lines, 1_500), 1_500],
  ])("letra deslocada em %s volta ao lugar com erro ≤ 30 ms", (_label, input, reference, expected, shiftMs) => {
    const result = alignmentService.align(input, reference);

    expect(result.aligned).toBe(true);
    expect(result.shiftMs).toBe(shiftMs);
    expect(result.lines).not.toBeNull();
    expect(maxError(result.lines ?? [], expected, reference.durationMs)).toBeLessThanOrEqual(30);
  });

  it("jitter de ±150 ms por linha é corrigido para ≤ 10 ms", () => {
    const jittered = jitterLines(lines, 7, 150);
    expect(maxError(jittered, lines, SONG_MS)).toBeGreaterThan(50); // o jitter existe

    const result = alignmentService.align(jittered, track);

    expect(result.aligned).toBe(true);
    expect(result.matchedRatio).toBe(1);
    expect(maxError(result.lines ?? [], lines, SONG_MS)).toBeLessThanOrEqual(10);
  });

  it("áudio 1,5 % mais lento: encaixa quem tem onset perto e só desloca o resto, sem escalar", () => {
    // Letra cronometrada numa versão mais rápida: as linhas chegam cada vez mais cedo.
    const faster = scaleLines(lines, 1 / 1.015);
    const onsets = new Set(lines.map((line) => line.startMs));

    const result = alignmentService.align(faster, track);

    expect(result.aligned).toBe(true);
    expect(Number.isInteger(result.shiftMs)).toBe(true);
    const aligned = result.lines ?? [];
    let snapped = 0;
    let shiftedOnly = 0;
    for (let i = 0; i < aligned.length; i++) {
      const startMs = aligned[i]?.startMs ?? -1;
      if (onsets.has(startMs)) {
        snapped++;
      } else {
        // Sem onset por perto: a linha recebe exatamente o deslocamento global (regra 4),
        // limitado ao fim do áudio.
        expect(startMs).toBe(Math.min(track.durationMs, (faster[i]?.startMs ?? 0) + result.shiftMs));
        shiftedOnly++;
      }
    }
    expect(snapped / aligned.length).toBeGreaterThanOrEqual(ALIGNMENT_CONFIG.shift.minMatchedRatio);
    expect(shiftedOnly).toBeGreaterThan(0); // a deriva acumulada no fim não é corrigida
  });

  it("referência sem relação com a letra → aligned false e lines null", () => {
    const result = alignmentService.align(lines, randomNotes(7, SONG_MS));

    expect(result.aligned).toBe(false);
    expect(result.lines).toBeNull();
  });

  it("letra deslocada além da varredura de 12 s → aligned false", () => {
    // Fora da varredura o deslocamento certo não existe. Na melodia sintética as frases vêm
    // a cada ~2,5–3,6 s, então um resto próximo de uma frase (ex.: 15 s − 12 s) casaria com a
    // frase seguinte (risco R3); 18 s deixa um resto que cai no meio das frases.
    const result = alignmentService.align(shiftLines(lines, 18_000), track);

    expect(result.aligned).toBe(false);
    expect(result.lines).toBeNull();
    expect(result.matchedRatio).toBeLessThan(ALIGNMENT_CONFIG.shift.minMatchedRatio);
  });

  it("referência só com silêncio → aligned false, sem lançar", () => {
    expect(alignmentService.align(lines, silence(track))).toEqual({
      aligned: false,
      shiftMs: 0,
      matchedRatio: 0,
      lines: null,
    });
  });

  it("menos de 3 linhas com texto → aligned false", () => {
    const few = [lines[0], lines[1], { startMs: lines[2]?.startMs ?? 0, text: "" }] as LyricLine[];

    expect(alignmentService.align(few, track).aligned).toBe(false);
  });

  it("linha sem texto recebe o deslocamento, mantém o texto vazio e nunca encaixa em onset", () => {
    const instrumental: LyricLine = { startMs: (lines[3]?.startMs ?? 0) + 700, text: "" };
    const withInstrumental = [...lines.slice(0, 4), instrumental, ...lines.slice(4)];

    const result = alignmentService.align(shiftLines(withInstrumental, 2_000), track);

    expect(result.aligned).toBe(true);
    expect(result.shiftMs).toBe(-2_000);
    expect(result.lines?.[4]).toEqual(instrumental);
    expect(result.lines?.length).toBe(withInstrumental.length);
  });

  it("cada onset encaixa uma linha só e a ordem fica crescente com ≥ 200 ms entre linhas", () => {
    const twin: LyricLine = { startMs: (lines[2]?.startMs ?? 0) + 50, text: "linha gêmea" };
    const withTwin = [...lines.slice(0, 3), twin, ...lines.slice(3)];

    const result = alignmentService.align(withTwin, track);
    const aligned = result.lines ?? [];

    expect(result.aligned).toBe(true);
    expect(aligned.filter((line) => line.startMs === lines[2]?.startMs)).toHaveLength(1);
    for (let i = 1; i < aligned.length; i++) {
      expect((aligned[i]?.startMs ?? 0) - (aligned[i - 1]?.startMs ?? 0)).toBeGreaterThanOrEqual(
        ALIGNMENT_CONFIG.snap.minLineGapMs,
      );
    }
  });

  it("nunca sai dos limites do áudio", () => {
    const result = alignmentService.align(shiftLines(lines, 9_000), delay(track, 9_000));
    const aligned = result.lines ?? [];

    expect(result.aligned).toBe(true);
    expect(result.shiftMs).toBe(0);
    for (const line of aligned) {
      expect(line.startMs).toBeGreaterThanOrEqual(0);
      expect(line.startMs).toBeLessThanOrEqual(track.durationMs);
    }
  });

  it("é determinístico e não altera a entrada", () => {
    const input = shiftLines(lines, 3_000);
    const snapshot = structuredClone(input);

    const first = alignmentService.align(input, track);
    const second = alignmentService.align(input, track);

    expect(second).toEqual(first);
    expect(input).toEqual(snapshot);
    expect(first.lines).not.toBe(input);
  });

  it("música de 10 min (60 000 frames) alinha em menos de 200 ms", () => {
    const long = makeMelody(3, 600_000);
    expect(long.track.midi).toHaveLength(60_000);
    expect(long.lines.length).toBeGreaterThan(100);

    const started = performance.now();
    const result = alignmentService.align(shiftLines(long.lines, 2_000), long.track);
    const elapsed = performance.now() - started;

    expect(result.aligned).toBe(true);
    expect(result.shiftMs).toBe(-2_000);
    expect(elapsed).toBeLessThan(200);
  });
});
