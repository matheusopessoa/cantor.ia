import { describe, expect, it } from "vitest";
import { ALIGNMENT_CONFIG, FORCED_CONFIG, alignmentService } from "../../services/alignment.service.js";
import { median } from "../../utils/pitch.js";
import type { LyricLine } from "../../utils/validators.js";
import { delay, forcedFrom, jitterLines, makeMelody, makeTrack, randomNotes, scaleLines, shiftLines, silence } from "../helpers/tracks.js";

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

    expect(result).toEqual({ aligned: true, shiftMs: 0, matchedRatio: 1, method: "onset", lines });
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
      method: "onset",
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

// ─── Alinhamento forçado (sdd-010) ───────────────────────────────────────────

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

describe("alignmentService.align — alinhamento forçado (sdd-010)", () => {
  it("letra deslocada volta exatamente para onde o worker ouviu cada linha", () => {
    const result = alignmentService.align(shiftLines(lines, 9_000), track, forcedFrom(lines));

    expect(result).toEqual({ aligned: true, shiftMs: -9_000, matchedRatio: 1, method: "forced", lines });
  });

  it("alinha mesmo sem nenhuma pausa na referência (o que derrotava o método por pausas)", () => {
    const continuous = makeTrack(new Array<number | null>(SONG_MS / 10).fill(60));
    expect(alignmentService.align(shiftLines(lines, 3_000), continuous).aligned).toBe(false);

    const result = alignmentService.align(shiftLines(lines, 3_000), continuous, forcedFrom(lines));

    expect(result.aligned).toBe(true);
    expect(result.method).toBe("forced");
    expect(result.lines).toEqual(lines);
  });

  it("linha com score abaixo de 0,4 é recusada e recebe o deslocamento da vizinha aceita anterior", () => {
    const input = shiftLines(lines, 2_000);
    const forced = forcedFrom(lines, { jitter: 300, seed: 3, scores: { 4: 0.39, 9: FORCED_CONFIG.minLineScore } });

    const result = alignmentService.align(input, track, forced);
    const aligned = result.lines ?? [];

    expect(result.aligned).toBe(true);
    expect(result.matchedRatio).toBe(round3((lines.length - 1) / lines.length));
    const delta3 = (forced.lines[3]?.startMs ?? 0) - (input[3]?.startMs ?? 0);
    expect(aligned[4]?.startMs).toBe((input[4]?.startMs ?? 0) + delta3);
    for (let i = 0; i < lines.length; i++) {
      if (i === 4) continue;
      expect(aligned[i]?.startMs).toBe(forced.lines[i]?.startMs); // aceitas ficam onde o worker ouviu
    }
  });

  it("linha 'cantada' por mais de 20 s é recusada", () => {
    const forced = forcedFrom(lines, { durations: { 2: FORCED_CONFIG.maxLineDurationMs + 20, 5: FORCED_CONFIG.maxLineDurationMs } });

    const result = alignmentService.align(shiftLines(lines, 1_000), track, forced);

    expect(result.matchedRatio).toBe(round3((lines.length - 1) / lines.length));
    expect(result.lines).toEqual(lines); // recusada herda o deslocamento (uniforme) da vizinha
  });

  it("menos da metade das linhas aceitas → aligned false, method forced e sem linhas", () => {
    const half = Math.ceil(lines.length / 2) + 1;
    const drop = Array.from({ length: half }, (_, i) => i * 2).filter((i) => i < lines.length);
    const lowScore = alignmentService.align(lines, track, forcedFrom(lines, { score: 0.2 }));
    const dropped = alignmentService.align(lines, track, forcedFrom(lines, { drop }));

    expect(lowScore).toEqual({ aligned: false, shiftMs: 0, matchedRatio: 0, method: "forced", lines: null });
    expect(dropped.aligned).toBe(false);
    expect(dropped.method).toBe("forced");
    expect(dropped.lines).toBeNull();
    expect(dropped.matchedRatio).toBeLessThan(FORCED_CONFIG.minMatchedRatio);
  });

  it("linhas recusadas no começo usam o deslocamento da próxima aceita", () => {
    const input = shiftLines(lines, 5_000);
    const forced = forcedFrom(lines, { drop: [0, 1], jitter: 200, seed: 11 });

    const aligned = alignmentService.align(input, track, forced).lines ?? [];

    const delta2 = (forced.lines[2]?.startMs ?? 0) - (input[2]?.startMs ?? 0);
    expect(aligned[0]?.startMs).toBe((input[0]?.startMs ?? 0) + delta2);
    expect(aligned[1]?.startMs).toBe((input[1]?.startMs ?? 0) + delta2);
  });

  it("linha instrumental recebe o deslocamento da vizinha, mantém o texto vazio e não conta", () => {
    const instrumental: LyricLine = { startMs: (lines[3]?.startMs ?? 0) + 700, text: "" };
    const truth = [...lines.slice(0, 4), instrumental, ...lines.slice(4)];
    const input = shiftLines(truth, 2_000);

    const result = alignmentService.align(input, track, forcedFrom(truth));

    expect(result.matchedRatio).toBe(1);
    expect(result.shiftMs).toBe(-2_000);
    expect(result.lines?.[4]).toEqual(instrumental);
    expect(result.lines?.length).toBe(truth.length);
  });

  it("linha recusada nunca empurra a aceita seguinte", () => {
    const forced = forcedFrom(lines, { drop: [3] });
    const early = (lines[3]?.startMs ?? 0) + 100; // o worker ouviu a linha 4 logo depois de onde a 3 estava
    forced.lines[4] = { index: 4, startMs: early, endMs: early + 2_000, score: 0.9 };

    const aligned = alignmentService.align(lines, track, forced).lines ?? [];

    expect(aligned[4]?.startMs).toBe(early);
    expect(aligned[3]?.startMs).toBe(early - FORCED_CONFIG.minLineGapMs);
    for (let i = 1; i < aligned.length; i++) {
      expect((aligned[i]?.startMs ?? 0) - (aligned[i - 1]?.startMs ?? 0)).toBeGreaterThanOrEqual(FORCED_CONFIG.minLineGapMs);
    }
  });

  it("ordem crescente com ≥ 200 ms entre linhas mesmo quando o worker colou duas", () => {
    const forced = forcedFrom(lines);
    const glued = lines[2]?.startMs ?? 0;
    forced.lines[3] = { index: 3, startMs: glued, endMs: glued + 500, score: 0.8 };

    const aligned = alignmentService.align(lines, track, forced).lines ?? [];

    expect(aligned[2]?.startMs).toBe(glued);
    expect(aligned[3]?.startMs).toBe(glued + FORCED_CONFIG.minLineGapMs);
  });

  it("shiftMs é a mediana arredondada de (alinhado − original) das linhas aceitas", () => {
    const input = shiftLines(lines, 4_000);
    const forced = forcedFrom(lines, { jitter: 300, seed: 5 });
    const deltas = forced.lines.map((line, i) => (line.startMs ?? 0) - (input[i]?.startMs ?? 0));

    const result = alignmentService.align(input, track, forced);

    expect(result.shiftMs).toBe(Math.round(median(deltas)));
    expect(Number.isInteger(result.shiftMs)).toBe(true);
  });

  it("alinhamento do worker com tamanho diferente da letra → cai no método por pausas", () => {
    const result = alignmentService.align(shiftLines(lines, 3_000), track, forcedFrom(lines.slice(1)));

    expect(result.method).toBe("onset");
    expect(result.aligned).toBe(true);
    expect(result.shiftMs).toBe(-3_000);
  });

  it("forced null ou ausente → método por pausas", () => {
    expect(alignmentService.align(lines, track, null).method).toBe("onset");
    expect(alignmentService.align(lines, track, undefined).method).toBe("onset");
  });

  it("worker não alinhou nenhuma linha → aligned false, method forced", () => {
    const result = alignmentService.align(lines, track, forcedFrom(lines, { drop: lines.map((_, i) => i) }));

    expect(result).toEqual({ aligned: false, shiftMs: 0, matchedRatio: 0, method: "forced", lines: null });
  });

  it("letra só com linhas vazias → aligned false, method forced", () => {
    const empty = lines.map((line) => ({ ...line, text: "" }));
    expect(alignmentService.align(empty, track, forcedFrom(empty)).aligned).toBe(false);
  });

  it("nunca sai dos limites do áudio", () => {
    const forced = forcedFrom(lines);
    const last = lines.length - 1;
    forced.lines[last] = { index: last, startMs: SONG_MS + 5_000, endMs: SONG_MS + 6_000, score: 0.9 };

    const aligned = alignmentService.align(lines, track, forced).lines ?? [];

    expect(aligned[last]?.startMs).toBe(SONG_MS);
    for (const line of aligned) {
      expect(line.startMs).toBeGreaterThanOrEqual(0);
      expect(line.startMs).toBeLessThanOrEqual(SONG_MS);
    }
  });

  it("é determinístico e não altera a entrada", () => {
    const input = shiftLines(lines, 3_000);
    const forced = forcedFrom(lines, { jitter: 200, seed: 9, drop: [2] });
    const snapshot = structuredClone({ input, forced });

    const first = alignmentService.align(input, track, forced);
    const second = alignmentService.align(input, track, forced);

    expect(second).toEqual(first);
    expect({ input, forced }).toEqual(snapshot);
  });
});
