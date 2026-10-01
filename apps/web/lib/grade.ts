export type Grade = "S" | "A" | "B" | "C" | "D";

/** Faixas do conceito, como no readme do design system: S ≥ 9.0 · A ≥ 7.0 · B ≥ 5.0 · C ≥ 3.0 · D. */
export function gradeForScore(score: number): Grade {
  if (score >= 9) return "S";
  if (score >= 7) return "A";
  if (score >= 5) return "B";
  if (score >= 3) return "C";
  return "D";
}
