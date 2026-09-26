import type { LyricLine } from "./validators.js";

/** `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]` (também `[mm:ss:xx]`). Sticky: consome tag a tag. */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/y;

/**
 * Converte a letra sincronizada do LRCLIB (formato LRC) em linhas com instante de entrada.
 *
 * - Aceita várias tags na mesma linha (`[00:10.00][01:20.00]refrão`): vira uma linha por tag.
 * - Ignora tags de metadado (`[ar:…]`, `[offset:…]`) e linhas sem tag de tempo.
 * - Preserva linhas com texto vazio (marcam trechos instrumentais).
 * - Devolve em ordem de `startMs` (ordenação estável).
 */
export function parseLrc(synced: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const raw of synced.split(/\r?\n/)) {
    const line = raw.trim();
    const starts: number[] = [];
    // Quando o regex sticky não casa mais, o JS zera o lastIndex: guardamos o fim da última tag.
    let textStart = 0;

    TIME_TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TIME_TAG.exec(line)) !== null) {
      starts.push(toMs(match[1] ?? "0", match[2] ?? "0", match[3]));
      textStart = match.index + match[0].length;
    }

    if (starts.length === 0) continue;

    const text = line.slice(textStart).trim();
    for (const startMs of starts) {
      lines.push({ startMs, text });
    }
  }

  return lines.sort((a, b) => a.startMs - b.startMs);
}

function toMs(minutes: string, seconds: string, fraction: string | undefined): number {
  const base = (Number(minutes) * 60 + Number(seconds)) * 1000;
  if (fraction === undefined) return base;
  // "5" → 500 ms, "34" → 340 ms, "345" → 345 ms
  return base + Number(fraction.padEnd(3, "0"));
}
