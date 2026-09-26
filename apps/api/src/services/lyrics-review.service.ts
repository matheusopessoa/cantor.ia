import { randomUUID } from "node:crypto";
import { workerClient, type WorkerAlignment } from "../clients/worker.client.js";
import { env } from "../config/env.js";
import { Prisma } from "../generated/prisma/client.js";
import { songRepository, type ReviewRow } from "../repositories/song.repository.js";
import {
  AlignmentUnavailableError,
  LyricsChangedError,
  ReferenceNotReadyError,
  ReviewCheckExpiredError,
  ReviewNeedsVideoError,
  SongNotFoundError,
} from "../utils/errors.js";
import type {
  ForcedAlignment,
  LyricLine,
  LyricsAlignment,
  LyricsEvidence,
  LyricsSelection,
  LyricsSource,
  PitchTrack,
  TranscriptWord,
} from "../utils/validators.js";
import { alignmentService } from "./alignment.service.js";
import { toSongDto, type SongDto } from "./song.service.js";

/**
 * Revisão da letra pelo Claude Code, via MCP (sdd-012). O Claude lê a letra com a evidência
 * (transcrição e candidatas), propõe a letra inteira, a API confere no áudio (o worker alinha
 * a atual e a proposta sobre a mesma voz) e, com a aprovação do usuário, grava.
 */
export const REVIEW_CONFIG = {
  /** Uma conferência vale por isto; depois (ou se a API reiniciar) é preciso conferir de novo (R2). */
  checkTtlMs: 30 * 60_000,
  /** Conferências guardadas em memória ao mesmo tempo (cada uma carrega a curva da música). */
  maxChecks: 50,
  /** Verso novo (sem par na letra atual) ganha a dica de tempo da vizinha mais isto. */
  lineHintStepMs: 1_000,
  /** A transcrição em versos, para o Claude ler: quebra numa pausa ≥ isto ou a cada tantas palavras (como o worker). */
  transcriptLinePauseMs: 600,
  transcriptLineMaxWords: 10,
} as const;

export type LineChange = "same" | "edited" | "added";

/** Uma linha da proposta comparada à letra atual. `currentIndex` é o verso que ela substitui (ou mantém). */
export interface LineDiff {
  index: number;
  text: string;
  change: LineChange;
  currentIndex: number | null;
}

export interface LyricsDiff {
  lines: LineDiff[];
  /** Versos da letra atual que a proposta não tem. */
  removed: { index: number; text: string }[];
}

export interface ReviewSongSummary {
  id: string;
  artist: string;
  title: string;
  /** Nulo nas músicas antigas (letra do LRCLIB, sem `lyricsSelection`). */
  lyricsSource: LyricsSource | null;
  /** Fração dos versos encaixados no áudio; nulo sem alinhamento. */
  matchedRatio: number | null;
  /** Quantidade de versos. */
  lines: number;
  reviewedAt: string | null;
}

export interface ReviewSongDetail {
  id: string;
  artist: string;
  title: string;
  youtubeVideoId: string | null;
  lyricsRevision: number;
  selection: LyricsSelection | null;
  /** A letra em uso (alinhada ao áudio quando há alinhamento). */
  lines: { index: number; text: string; startMs: number }[];
  /** A transcrição da voz em versos; nula sem evidência (música antiga ou anterior à sdd-012). */
  transcriptLines: { text: string; startMs: number }[] | null;
  candidates: { source: "lrclib" | "ytmusic"; lines: string[] }[] | null;
}

export interface ReviewCheckLine {
  index: number;
  text: string;
  startMs: number;
  /** Confiança do alinhador no verso proposto (0..1); nulo sem texto alinhável. */
  score: number | null;
  change: LineChange;
  before?: { text: string; score: number | null };
}

export interface ReviewCheck {
  checkId: string;
  expiresAt: string;
  lines: ReviewCheckLine[];
  removed: { text: string; score: number | null }[];
  summary: {
    edited: number;
    added: number;
    removed: number;
    meanScoreBefore: number | null;
    meanScoreAfter: number | null;
  };
}

interface StoredCheck {
  songId: string;
  revision: number;
  proposed: LyricLine[];
  track: PitchTrack;
  alignment: ForcedAlignment | null;
  expiresAt: number;
}

// ─── Funções puras ───────────────────────────────────────────────────────────

/** Texto comparável para casar versos: sem acento, minúsculas, só letras e números. */
export function normalizeLine(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Pares `(i, j)` da maior subsequência comum entre `a` e `b`, em ordem crescente. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const diagonal = table[i + 1]?.[j + 1] ?? 0;
      const down = table[i + 1]?.[j] ?? 0;
      const right = table[i]?.[j + 1] ?? 0;
      const row = table[i];
      if (row) row[j] = a[i] === b[j] ? diagonal + 1 : Math.max(down, right);
    }
  }

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Diff verso a verso entre a letra atual e a proposta (regra 4). Os versos que casam pelo
 * texto normalizado (LCS) ancoram; entre duas âncoras, os versos sem par são emparelhados na
 * ordem (`edited`), e o que sobra é `added` (na proposta) ou `removed` (na atual). Um verso
 * casado pela normalização mas com o texto diferente (acento, pontuação) é `edited`.
 */
export function diffLines(current: string[], proposed: string[]): LyricsDiff {
  const pairs = lcsPairs(current.map(normalizeLine), proposed.map(normalizeLine));
  const lines: LineDiff[] = [];
  const removed: { index: number; text: string }[] = [];

  let i = 0;
  let j = 0;
  const gap = (untilI: number, untilJ: number) => {
    while (i < untilI && j < untilJ) {
      lines.push({ index: j, text: proposed[j] ?? "", change: "edited", currentIndex: i });
      i++;
      j++;
    }
    while (i < untilI) removed.push({ index: i, text: current[i++] ?? "" });
    while (j < untilJ) {
      lines.push({ index: j, text: proposed[j] ?? "", change: "added", currentIndex: null });
      j++;
    }
  };

  for (const [ci, pj] of pairs) {
    gap(ci, pj);
    const same = (current[ci] ?? "").trim() === (proposed[pj] ?? "").trim();
    lines.push({ index: pj, text: proposed[pj] ?? "", change: same ? "same" : "edited", currentIndex: ci });
    i = ci + 1;
    j = pj + 1;
  }
  gap(current.length, proposed.length);

  return { lines, removed };
}

/**
 * Dica de `startMs` de cada verso proposto (R5): a do verso atual que ele substitui; verso
 * novo herda a vizinha anterior mais um passo (as do começo, a seguinte menos o passo). Sem
 * nenhum par, os versos são espalhados a um passo cada. O tempo final vem do alinhamento.
 */
export function proposedHints(current: LyricLine[], diff: LineDiff[]): LyricLine[] {
  const { lineHintStepMs } = REVIEW_CONFIG;
  const hints: (number | null)[] = diff.map((line) =>
    line.currentIndex === null ? null : (current[line.currentIndex]?.startMs ?? null),
  );

  if (hints.every((hint) => hint === null)) {
    return diff.map((line, index) => ({ text: line.text, startMs: index * lineHintStepMs }));
  }
  for (let index = 1; index < hints.length; index++) {
    const previous = hints[index - 1];
    if (hints[index] === null && previous !== null && previous !== undefined) hints[index] = previous + lineHintStepMs;
  }
  for (let index = hints.length - 2; index >= 0; index--) {
    const next = hints[index + 1];
    if (hints[index] === null && next !== null && next !== undefined) hints[index] = Math.max(0, next - lineHintStepMs);
  }

  return diff.map((line, index) => ({ text: line.text, startMs: Math.max(0, hints[index] ?? 0) }));
}

/** A transcrição em versos (mesma quebra do worker): pausa ≥ 600 ms ou a cada 10 palavras. */
export function transcriptToLines(words: TranscriptWord[]): { text: string; startMs: number }[] {
  const { transcriptLinePauseMs, transcriptLineMaxWords } = REVIEW_CONFIG;
  const lines: { text: string; startMs: number }[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    const first = current[0];
    if (first) lines.push({ text: current.map((word) => word.text).join(" "), startMs: first.startMs });
    current = [];
  };

  for (const word of words) {
    const last = current[current.length - 1];
    if (last && (word.startMs - last.endMs >= transcriptLinePauseMs || current.length >= transcriptLineMaxWords)) flush();
    current.push(word);
  }
  flush();
  return lines;
}

function effectiveLyrics(song: { lyrics: unknown; alignedLyrics: unknown }): LyricLine[] {
  return (song.alignedLyrics ?? song.lyrics) as LyricLine[];
}

function scoreAt(alignment: ForcedAlignment | null, index: number, expectedLength: number): number | null {
  if (alignment === null || alignment.lines.length !== expectedLength) return null;
  return alignment.lines[index]?.score ?? null;
}

function mean(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return Math.round((present.reduce((sum, value) => sum + value, 0) / present.length) * 1000) / 1000;
}

function toSummary(row: ReviewRow): ReviewSongSummary {
  const selection = row.lyricsSelection as LyricsSelection | null;
  const alignment = row.lyricsAlignment as LyricsAlignment | null;
  return {
    id: row.id,
    artist: row.artist,
    title: row.title,
    lyricsSource: selection?.source ?? null,
    matchedRatio: alignment?.matchedRatio ?? null,
    lines: (row.lyrics as LyricLine[]).length,
    reviewedAt: selection?.reviewedAt ?? null,
  };
}

/** Ordem da lista (regra 3): `whisper` primeiro, depois menor encaixe, depois mais antigas. */
export function sortForReview(rows: ReviewRow[]): ReviewSongSummary[] {
  return rows
    .map(toSummary)
    .sort(
      (a, b) =>
        Number(b.lyricsSource === "whisper") - Number(a.lyricsSource === "whisper") ||
        (a.matchedRatio ?? 1) - (b.matchedRatio ?? 1),
    );
}

// ─── Conferências em memória ─────────────────────────────────────────────────

const checks = new Map<string, StoredCheck>();

function storeCheck(check: StoredCheck): string {
  const now = Date.now();
  for (const [id, stored] of checks) if (stored.expiresAt <= now) checks.delete(id);
  while (checks.size >= REVIEW_CONFIG.maxChecks) {
    const oldest = checks.keys().next().value;
    if (oldest === undefined) break;
    checks.delete(oldest);
  }
  const id = randomUUID();
  checks.set(id, check);
  return id;
}

function findCheck(id: string, now = Date.now()): StoredCheck | null {
  const check = checks.get(id);
  if (!check) return null;
  if (check.expiresAt <= now) {
    checks.delete(id);
    return null;
  }
  return check;
}

export const lyricsReviewService = {
  /** Músicas `READY`, na ordem da regra 3, até `limit`. 1 query, sem curva nem evidência. */
  async list(limit: number): Promise<ReviewSongSummary[]> {
    const rows = await songRepository.findForReview();
    return sortForReview(rows).slice(0, limit);
  },

  /** A letra em uso com a evidência (transcrição em versos e candidatas). 1 query. */
  async detail(id: string): Promise<ReviewSongDetail> {
    const song = await songRepository.findForReviewDetail(id);
    if (!song) throw new SongNotFoundError(id);

    const evidence = song.lyricsEvidence as LyricsEvidence | null;
    return {
      id: song.id,
      artist: song.artist,
      title: song.title,
      youtubeVideoId: song.youtubeVideoId,
      lyricsRevision: song.lyricsRevision,
      selection: song.lyricsSelection as LyricsSelection | null,
      lines: effectiveLyrics(song).map((line, index) => ({ index, text: line.text, startMs: line.startMs })),
      transcriptLines: evidence ? transcriptToLines(evidence.transcript) : null,
      candidates: evidence
        ? evidence.candidates.map((candidate) => ({ source: candidate.source, lines: candidate.lines.map((line) => line.text) }))
        : null,
    };
  },

  /**
   * Confere a proposta no áudio (regra 5): o worker alinha a letra atual e a proposta sobre a
   * mesma voz; a resposta traz o antes/depois por verso. Nada é gravado: o resultado fica em
   * memória por `checkTtlMs` para o `apply`.
   */
  async check(id: string, lines: string[]): Promise<ReviewCheck> {
    const song = await songRepository.findWithReference(id);
    if (!song) throw new SongNotFoundError(id);
    if (song.referenceStatus !== "READY" || song.referenceTrack === null) throw new ReferenceNotReadyError();
    if (song.youtubeVideoId === null) throw new ReviewNeedsVideoError();

    const current = effectiveLyrics(song);
    const diff = diffLines(
      current.map((line) => line.text),
      lines,
    );
    const proposed = proposedHints(current, diff.lines);

    let aligned: WorkerAlignment;
    try {
      aligned = await workerClient.alignFromYoutube(song.youtubeVideoId, current, proposed);
    } catch (error) {
      if (env.NODE_ENV !== "test") console.error(`[lyrics-review] check for song ${id} failed:`, error);
      throw new AlignmentUnavailableError();
    }

    const before = (index: number) => scoreAt(aligned.current, index, current.length);
    const after = (index: number) => scoreAt(aligned.proposed, index, proposed.length);

    const checkLines: ReviewCheckLine[] = diff.lines.map((line, index) => ({
      index,
      text: line.text,
      startMs: (aligned.proposed?.lines.length === proposed.length ? aligned.proposed.lines[index]?.startMs : null) ?? proposed[index]?.startMs ?? 0,
      score: after(index),
      change: line.change,
      ...(line.currentIndex === null
        ? {}
        : { before: { text: current[line.currentIndex]?.text ?? "", score: before(line.currentIndex) } }),
    }));
    const removed = diff.removed.map((line) => ({ text: line.text, score: before(line.index) }));

    const expiresAt = Date.now() + REVIEW_CONFIG.checkTtlMs;
    const checkId = storeCheck({
      songId: id,
      revision: song.lyricsRevision,
      proposed,
      track: song.referenceTrack as PitchTrack,
      alignment: aligned.proposed,
      expiresAt,
    });

    return {
      checkId,
      expiresAt: new Date(expiresAt).toISOString(),
      lines: checkLines,
      removed,
      summary: {
        edited: checkLines.filter((line) => line.change === "edited").length,
        added: checkLines.filter((line) => line.change === "added").length,
        removed: removed.length,
        meanScoreBefore: mean(current.map((_line, index) => before(index))),
        meanScoreAfter: mean(checkLines.map((line) => line.score)),
      },
    };
  },

  /**
   * Grava a proposta conferida (regra 7): a letra vira a proposta com a dica de tempo, o
   * alinhamento é refeito com o resultado da conferência (`alignmentService`, sem chamar o
   * worker), `lyricsSelection` ganha `reviewedAt` (a `source` não muda, regra 8) e a versão
   * incrementa. Só grava se a versão não mudou desde a conferência.
   */
  async apply(id: string, checkId: string): Promise<SongDto> {
    const check = findCheck(checkId);
    if (!check || check.songId !== id) throw new ReviewCheckExpiredError();

    const song = await songRepository.findById(id);
    if (!song) throw new SongNotFoundError(id);
    if (song.referenceStatus !== "READY") throw new ReferenceNotReadyError();
    if (song.lyricsRevision !== check.revision) throw new LyricsChangedError();

    const alignment = alignmentService.align(check.proposed, check.track, check.alignment);
    const previous = (song.lyricsSelection as LyricsSelection | null) ?? { source: "lrclib" as const, wer: null, candidates: [] };
    const selection: LyricsSelection = { ...previous, reviewedAt: new Date().toISOString() };

    const applied = await songRepository.applyLyricsReview(id, check.revision, {
      lyrics: check.proposed,
      alignedLyrics: alignment.lines ?? Prisma.DbNull,
      lyricsAlignment: { aligned: alignment.aligned, shiftMs: alignment.shiftMs, matchedRatio: alignment.matchedRatio, method: alignment.method },
      lyricsSelection: selection,
    });
    if (!applied) {
      const now = await songRepository.findById(id);
      if (now?.referenceStatus !== "READY") throw new ReferenceNotReadyError();
      throw new LyricsChangedError();
    }
    checks.delete(checkId);

    const fresh = await songRepository.findById(id);
    if (!fresh) throw new SongNotFoundError(id);
    return toSongDto(fresh);
  },
};
