"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { DIFFICULTY_LABEL } from "@/lib/difficulty";
import { formatScore } from "@/lib/format";
import { gradeForScore } from "@/lib/grade";
import type { PerformanceResult } from "@/lib/types";

interface ScoreResultProps {
  result: PerformanceResult;
  songId: string;
  onRetry: () => void;
}

/** Duração da contagem da nota subindo (`--dur-count` do DS). */
const COUNT_MS = 1200;
/** Entrada fora disto (ms) conta como "não entrou no tempo" (igual ao `fullCreditMs` da nota). */
const ON_TIME_MS = 400;

function useCountUp(target: number): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    // Com movimento reduzido a nota aparece direto no valor final (DS, princípio 5).
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - began) / COUNT_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return value;
}

function timingRemark(result: PerformanceResult): string | null {
  const missed = result.lines.filter(
    (line) => line.onsetDeltaMs === null || Math.abs(line.onsetDeltaMs) > ON_TIME_MS,
  ).length;
  if (missed === 0) return null;
  return missed === 1 ? "Faltou entrar no tempo em 1 verso." : `Faltou entrar no tempo em ${missed} versos.`;
}

type MeterKind = "pitch" | "timing" | "rhythm";

/** Rótulo e cor de cada medidor (`.ct-meter--pitch/--timing/--rhythm` do DS). */
const METER: Record<MeterKind, { label: string; valueClass: string }> = {
  pitch: { label: "Afinação", valueClass: "ct-neon-cyan" },
  timing: { label: "Tempo", valueClass: "ct-neon-pink" },
  rhythm: { label: "Ritmo", valueClass: "text-fret-green" },
};

function Meter({ kind, value }: { kind: MeterKind; value: number }) {
  const { label, valueClass } = METER[kind];
  return (
    <div className={`ct-meter ct-meter--${kind}`}>
      <div className="ct-meter__head">
        <span className="ct-label">{label}</span>
        <span className={`ct-numeric ${valueClass}`}>{formatScore(value)}</span>
      </div>
      <div
        className="ct-meter__bar"
        style={{ "--value": value / 10 } as CSSProperties}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value}
        aria-label={label}
      />
    </div>
  );
}

/**
 * Medidores do nível (sdd-009): o fácil não mede afinação, então mostra Tempo e Ritmo; médio
 * e difícil mostram Afinação e Tempo.
 */
function metersFor(result: PerformanceResult): { kind: MeterKind; value: number }[] {
  if (result.difficulty === "EASY") {
    return [
      { kind: "timing", value: result.timingScore },
      { kind: "rhythm", value: result.rhythmScore },
    ];
  }
  return [
    { kind: "pitch", value: result.pitchScore },
    { kind: "timing", value: result.timingScore },
  ];
}

/** Placar final: nota em Press Start, conceito, medidores do nível e posição no ranking. */
export function ScoreResult({ result, songId, onRetry }: ScoreResultProps) {
  const shown = useCountUp(result.score);
  const grade = gradeForScore(result.score);
  const isRecord = result.rank === 1;
  const remark = timingRemark(result);
  const level = DIFFICULTY_LABEL[result.difficulty];

  return (
    <section className="ct-panel ct-panel--pink grid justify-items-center gap-8 px-6 py-12" aria-label="Resultado">
      {isRecord ? <span className="ct-badge ct-badge--new-record">Novo recorde</span> : null}

      <div className="flex flex-wrap items-center justify-center gap-8">
        <div className="ct-score">
          <span className="ct-label">Sua nota · {level}</span>
          <span className="ct-score__value">
            {formatScore(shown)}
            <span className="ct-score__max">/10</span>
          </span>
        </div>
        <span className="ct-grade" data-grade={grade} aria-label={`Conceito ${grade}`}>
          {grade}
        </span>
      </div>

      <p className="text-center text-fg-2">
        {isRecord ? `Novo recorde no ${level.toLowerCase()}. Seu nome está no topo.` : `Você ficou em ${result.rank}º lugar no ${level.toLowerCase()}.`}
        {remark ? ` ${remark}` : ""}
      </p>

      <div className="grid w-full gap-4">
        {metersFor(result).map((meter) => (
          <Meter key={meter.kind} kind={meter.kind} value={meter.value} />
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        <button type="button" className="ct-btn ct-btn--primary" onClick={onRetry}>
          Cantar de novo
        </button>
        <Link href={`/songs/${songId}`} className="ct-btn ct-btn--secondary">
          Voltar à música
        </Link>
        <Link href="/" className="ct-btn ct-btn--ghost">
          Outra música
        </Link>
      </div>
    </section>
  );
}
