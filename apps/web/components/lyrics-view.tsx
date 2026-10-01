import type { CSSProperties } from "react";
import type { LyricLine } from "@/lib/types";

interface LyricsViewProps {
  lines: LyricLine[];
  /** Linha atual (-1 antes da primeira). */
  currentIndex: number;
  /** Preenchimento 0..1 da linha atual. */
  progress: number;
}

/** Linha sem texto (pausa instrumental). Sem emoji, por regra do DS. */
const INSTRUMENTAL = "· · ·";

function text(line: LyricLine | undefined): string {
  const value = line?.text.trim() ?? "";
  return value.length > 0 ? value : INSTRUMENTAL;
}

/** Letra de karaokê: anterior apagada, atual enchendo em ciano, próximas em lilás. */
export function LyricsView({ lines, currentIndex, progress }: LyricsViewProps) {
  const past = currentIndex > 0 ? lines[currentIndex - 1] : undefined;
  const current = currentIndex >= 0 ? lines[currentIndex] : undefined;
  const nextStart = currentIndex + 1;
  const next = lines.slice(Math.max(0, nextStart), Math.max(0, nextStart) + 2);

  return (
    <div className="ct-lyrics min-h-[220px]" aria-live="polite">
      {past ? <p className="ct-lyric is-past">{text(past)}</p> : null}
      {current ? (
        <p className="ct-lyric is-current" style={{ "--progress": progress } as CSSProperties}>
          <span className="ct-lyric__text">{text(current)}</span>
        </p>
      ) : null}
      {next.map((line, i) => (
        <p key={nextStart + i} className="ct-lyric is-next">
          {text(line)}
        </p>
      ))}
    </div>
  );
}
