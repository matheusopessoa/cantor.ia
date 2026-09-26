/**
 * Cliente HTTP das rotas `/api/review/*` da API (sdd-012). Os tipos espelham
 * `apps/api/src/services/lyrics-review.service.ts` e `song.service.ts`; se divergirem, a API
 * prevalece e este arquivo é corrigido.
 */

export type LyricsSource = "lrclib" | "ytmusic" | "whisper";
export type LineChange = "same" | "edited" | "added";

export interface ReviewSongSummary {
  id: string;
  artist: string;
  title: string;
  lyricsSource: LyricsSource | null;
  matchedRatio: number | null;
  lines: number;
  reviewedAt: string | null;
}

export interface LyricsSelection {
  source: LyricsSource;
  wer: number | null;
  candidates: { source: "lrclib" | "ytmusic"; wer: number | null }[];
  reviewedAt?: string;
}

export interface ReviewSongDetail {
  id: string;
  artist: string;
  title: string;
  youtubeVideoId: string | null;
  lyricsRevision: number;
  selection: LyricsSelection | null;
  lines: { index: number; text: string; startMs: number }[];
  transcriptLines: { text: string; startMs: number }[] | null;
  candidates: { source: "lrclib" | "ytmusic"; lines: string[] }[] | null;
}

export interface ReviewCheckLine {
  index: number;
  text: string;
  startMs: number;
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

/** O `SongDto` da API, só com o que o MCP mostra depois de gravar. */
export interface AppliedSong {
  id: string;
  artist: string;
  title: string;
  lyrics: { startMs: number; text: string }[];
  alignedLyrics: { startMs: number; text: string }[] | null;
  lyricsAlignment: { aligned: boolean; shiftMs: number; matchedRatio: number; method?: "forced" | "onset" } | null;
  lyricsSelection: LyricsSelection | null;
}

/** Falha da API (status + `code`) ou da rede (`status` 0 com `UNREACHABLE`/`TIMEOUT`). */
export class ReviewApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ReviewApiError";
  }
}

/** A conferência baixa o áudio e roda o Demucs e o alinhador (≤ 3 min em CPU). */
export const REVIEW_API_TIMEOUTS_MS = {
  default: 30_000,
  check: 6 * 60_000,
} as const;

export interface ReviewApiOptions {
  baseUrl: string;
  secret: string;
  /** Para os testes: um `fetch` falso. */
  fetch?: typeof fetch;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createReviewApi({ baseUrl, secret, fetch: fetchFn = fetch }: ReviewApiOptions) {
  const base = baseUrl.replace(/\/$/, "");

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs: number = REVIEW_API_TIMEOUTS_MS.default): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${secret}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ReviewApiError(0, "TIMEOUT", `A API não respondeu ${path} em ${Math.round(timeoutMs / 1000)} s`);
      }
      throw new ReviewApiError(0, "UNREACHABLE", `Não deu para falar com a API em ${base}: ${describeError(error)}`);
    }

    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // corpo não é JSON: fica só o status
      }
      const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const code = typeof record["code"] === "string" ? record["code"] : null;
      const message = typeof record["message"] === "string" ? record["message"] : `HTTP ${response.status}`;
      throw new ReviewApiError(response.status, code, message);
    }

    return (await response.json()) as T;
  }

  return {
    listSongs(limit?: number): Promise<ReviewSongSummary[]> {
      const query = limit === undefined ? "" : `?limit=${limit}`;
      return request<ReviewSongSummary[]>("GET", `/api/review/songs${query}`);
    },

    getSong(songId: string): Promise<ReviewSongDetail> {
      return request<ReviewSongDetail>("GET", `/api/review/songs/${encodeURIComponent(songId)}`);
    },

    check(songId: string, lines: string[]): Promise<ReviewCheck> {
      return request<ReviewCheck>("POST", `/api/review/songs/${encodeURIComponent(songId)}/check`, { lines }, REVIEW_API_TIMEOUTS_MS.check);
    },

    apply(songId: string, checkId: string): Promise<AppliedSong> {
      return request<AppliedSong>("POST", `/api/review/songs/${encodeURIComponent(songId)}/apply`, { checkId });
    },
  };
}

export type ReviewApi = ReturnType<typeof createReviewApi>;
