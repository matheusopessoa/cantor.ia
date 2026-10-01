import { workerClient, type WorkerYoutubeCandidate } from "../clients/worker.client.js";
import { env } from "../config/env.js";
import { songRepository } from "../repositories/song.repository.js";
import { SongNotFoundError, YoutubeSearchUnavailableError } from "../utils/errors.js";
import { DURATION_TOLERANCE_MS, type SongDto } from "./song.service.js";

/**
 * Sugestão do vídeo do YouTube para a referência (sdd-008). `rank` é função pura, no modelo
 * do `scoring.service.ts`; `forSong` orquestra repositório, worker e um cache em memória.
 * Nunca processa nada: quem escolhe o candidato é o usuário, na rota atual de referência.
 */
export const SUGGESTION_CONFIG = {
  /** A consulta enviada ao worker (`"<artista> <título>"`) é cortada neste tamanho. */
  queryMaxLength: 200,
  /** Candidato fora desta janela em relação à letra nem aparece (mesma regra da referência). */
  durationToleranceMs: DURATION_TOLERANCE_MS,
  /** Até aqui a duração conta como "exata": bônus e desempate final. */
  exactDurationMs: 2_000,
  weights: {
    topicChannel: 3,
    officialAudio: 3,
    official: 1,
    lyric: 1,
    artistChannel: 2,
    titleMatch: 1,
    exactDuration: 1,
    badToken: -5,
  },
  /** Casados no início de palavra, sem acento, exceto quando a própria letra os contém. */
  badTokens: [
    "live",
    "ao vivo",
    "acustic",
    "acústic",
    "cover",
    "karaok",
    "remix",
    "instrumental",
    "playback",
    "sped up",
    "slowed",
    "reaction",
    "reação",
    "8d",
    "nightcore",
  ],
  /**
   * Pontuação mínima da camada 1. Além dela, o candidato precisa de uma marca de oficial de
   * verdade (canal "- Topic", "official audio", canal do artista, "official", "lyric"):
   * título certo + duração exata somam 2, mas não são marca de oficial (regra 4).
   */
  officialMin: 2,
  confidence: {
    /** Camada 1 com esta folga sobre o segundo oficial → `high`. */
    high: { gap: 2 },
    /** Sem oficial, o mais visto com pelo menos isto → `medium`; senão `low`. */
    medium: { views: 100_000 },
  },
  maxCandidates: 5,
  cache: { ttlMs: 10 * 60_000, maxEntries: 500 },
} as const;

export type YoutubeCandidateReason =
  | "TOPIC_CHANNEL"
  | "OFFICIAL_AUDIO"
  | "ARTIST_CHANNEL"
  | "LYRIC_VIDEO"
  | "OFFICIAL"
  | "MOST_VIEWED"
  | "EXACT_DURATION";

export type SuggestionConfidence = "none" | "low" | "medium" | "high";

export interface YoutubeCandidateDto {
  videoId: string;
  title: string;
  channel: string | null;
  durationMs: number;
  viewCount: number | null;
  score: number;
  /** 1 = tem marca de oficial; 2 = escolhido pelas visualizações. */
  tier: 1 | 2;
  /** Motivos legíveis pelo web (códigos; o texto fica no `lib/youtube.ts`). */
  reasons: YoutubeCandidateReason[];
}

export interface YoutubeSuggestion {
  /** A consulta enviada ao worker, para diagnóstico. */
  query: string;
  confidence: SuggestionConfidence;
  /** Até 5, já ordenados. */
  candidates: YoutubeCandidateDto[];
}

type SongForSuggestion = Pick<SongDto, "artist" | "title" | "album" | "durationMs">;

/** Minúsculas, sem acentos, sem pontuação, espaços únicos. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** `token` no início de uma palavra de `text` ("live" casa "live" e "livestream", não "alive"). */
function hasToken(text: string, token: string): boolean {
  return ` ${text} `.includes(` ${token}`);
}

/** Sem parênteses/colchetes ("(Remastered 2011)", "[Live]") nem "feat." (R2). Vazio → o original. */
function stripDecorations(text: string): string {
  const stripped = text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || text.trim();
}

/**
 * `"<artista> <título>"` limpos (`stripDecorations`), com espaços normalizados e no máximo
 * 200 caracteres. Acentos ficam: o YouTube lida bem com eles, e a grafia do LRCLIB é a
 * canônica.
 */
export function buildQuery(song: Pick<SongDto, "artist" | "title">): string {
  return `${stripDecorations(song.artist)} ${stripDecorations(song.title)}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUGGESTION_CONFIG.queryMaxLength)
    .trim();
}

const OFFICIAL_MARKS: ReadonlySet<YoutubeCandidateReason> = new Set<YoutubeCandidateReason>([
  "TOPIC_CHANNEL",
  "OFFICIAL_AUDIO",
  "ARTIST_CHANNEL",
  "OFFICIAL",
  "LYRIC_VIDEO",
]);

interface Scored {
  candidate: WorkerYoutubeCandidate;
  index: number;
  durationMs: number;
  deltaMs: number;
  exact: boolean;
  views: number;
  score: number;
  tier: 1 | 2;
  /** Tem alguma palavra "ruim" (ao vivo, cover, karaokê…): vai para o fim da camada 2. */
  penalized: boolean;
  reasons: YoutubeCandidateReason[];
}

/** Ordem de grandeza das visualizações (0 → -1, 999 → 2, 1 000 → 3). Exata, sem `log10`. */
function magnitude(views: number): number {
  return views <= 0 ? -1 : String(Math.trunc(views)).length - 1;
}

/**
 * Camada 1 (oficial): pontuação, visualizações, duração, ordem da busca. Camada 2 (o resto):
 * penalizados por último, ordem de grandeza das visualizações, duração exata,
 * visualizações, duração, ordem da busca.
 *
 * Desempate escolhido para a camada 2: dois vídeos na mesma ordem de grandeza de
 * visualizações são "igualmente vistos", e aí vence o de duração exata; com uma ordem de
 * grandeza de diferença, vence o mais visto. Ao vivo, cover, karaokê etc. nunca passam na
 * frente de um áudio comum só por serem mais vistos (regra 4).
 */
function compare(a: Scored, b: Scored): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.tier === 1) {
    if (a.score !== b.score) return b.score - a.score;
  } else {
    if (a.penalized !== b.penalized) return a.penalized ? 1 : -1;
    const byMagnitude = magnitude(b.views) - magnitude(a.views);
    if (byMagnitude !== 0) return byMagnitude;
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
  }
  if (a.views !== b.views) return b.views - a.views;
  if (a.deltaMs !== b.deltaMs) return a.deltaMs - b.deltaMs;
  return a.index - b.index;
}

function scoreCandidate(
  song: SongForSuggestion,
  candidate: WorkerYoutubeCandidate,
  index: number,
  artist: string,
  title: string,
  exempt: Set<string>,
): Scored | null {
  if (candidate.isLive || candidate.durationS === null) return null;

  const durationMs = Math.round(candidate.durationS * 1000);
  const deltaMs = Math.abs(durationMs - song.durationMs);
  if (deltaMs > SUGGESTION_CONFIG.durationToleranceMs) return null;

  const { weights } = SUGGESTION_CONFIG;
  const t = normalize(candidate.title);
  const ch = normalize(candidate.channel ?? "");
  const reasons: YoutubeCandidateReason[] = [];
  let score = 0;

  if (ch.endsWith("topic")) {
    score += weights.topicChannel;
    reasons.push("TOPIC_CHANNEL");
  }
  if (t.includes("official audio") || t.includes("audio oficial")) {
    score += weights.officialAudio;
    reasons.push("OFFICIAL_AUDIO");
  } else if (t.includes("official") || t.includes("oficial")) {
    score += weights.official;
    reasons.push("OFFICIAL");
  }
  if (t.includes("lyric")) {
    score += weights.lyric;
    reasons.push("LYRIC_VIDEO");
  }
  if ((artist.length > 0 && ch.includes(artist)) || ch.includes("vevo")) {
    score += weights.artistChannel;
    reasons.push("ARTIST_CHANNEL");
  }
  if (artist.length > 0 && title.length > 0 && t.includes(artist) && t.includes(title)) {
    score += weights.titleMatch;
  }
  const exact = deltaMs <= SUGGESTION_CONFIG.exactDurationMs;
  if (exact) {
    score += weights.exactDuration;
    reasons.push("EXACT_DURATION");
  }
  let penalized = false;
  for (const token of SUGGESTION_CONFIG.badTokens) {
    const bad = normalize(token);
    if (!exempt.has(bad) && hasToken(t, bad)) {
      score += weights.badToken;
      penalized = true;
    }
  }

  const official = !penalized && score >= SUGGESTION_CONFIG.officialMin && reasons.some((r) => OFFICIAL_MARKS.has(r));

  return {
    candidate,
    index,
    durationMs,
    deltaMs,
    exact,
    views: candidate.viewCount ?? 0,
    score,
    tier: official ? 1 : 2,
    penalized,
    reasons,
  };
}

function confidenceOf(sorted: Scored[]): SuggestionConfidence {
  const top = sorted[0];
  if (!top) return "none";

  if (top.tier === 1) {
    const secondOfficial = sorted[1]?.tier === 1 ? sorted[1] : null;
    if (secondOfficial === null || top.score - secondOfficial.score >= SUGGESTION_CONFIG.confidence.high.gap) {
      return "high";
    }
    return "medium";
  }

  return top.views >= SUGGESTION_CONFIG.confidence.medium.views ? "medium" : "low";
}

function toDto({ candidate, durationMs, score, tier, reasons }: Scored): YoutubeCandidateDto {
  return {
    videoId: candidate.videoId,
    title: candidate.title,
    channel: candidate.channel,
    durationMs,
    viewCount: candidate.viewCount,
    score,
    tier,
    reasons,
  };
}

/**
 * Ranking determinístico em duas camadas (sdd-008 §3). Filtra por duração (±10 s), descarta
 * ao vivo e sem duração, pontua marcas de oficial e penaliza palavras "ruins" que não estão
 * na própria letra (título/álbum "Ao Vivo" não penaliza "ao vivo"). `viewCount` nulo conta
 * como 0. Devolve no máximo 5.
 */
export function rank(song: SongForSuggestion, candidates: WorkerYoutubeCandidate[]): YoutubeSuggestion {
  const artist = normalize(stripDecorations(song.artist));
  const title = normalize(stripDecorations(song.title));
  const own = normalize(`${song.title} ${song.album ?? ""}`);
  const exempt = new Set(SUGGESTION_CONFIG.badTokens.map(normalize).filter((token) => hasToken(own, token)));

  const sorted = candidates
    .map((candidate, index) => scoreCandidate(song, candidate, index, artist, title, exempt))
    .filter((scored): scored is Scored => scored !== null)
    .sort(compare);

  // O primeiro da camada 2 é o mais visto com a duração certa (decisão do usuário).
  const mostViewed = sorted.find((scored) => scored.tier === 2);
  if (mostViewed && mostViewed.views > 0) mostViewed.reasons.push("MOST_VIEWED");

  return {
    query: buildQuery(song),
    confidence: confidenceOf(sorted),
    candidates: sorted.slice(0, SUGGESTION_CONFIG.maxCandidates).map(toDto),
  };
}

// ─── Cache em memória por música (regra 6; R5) ──────────────────────────────

interface CacheEntry {
  at: number;
  result: YoutubeSuggestion;
}

const cache = new Map<string, CacheEntry>();

function readCache(songId: string, now: number): YoutubeSuggestion | null {
  const entry = cache.get(songId);
  if (!entry) return null;
  if (now - entry.at >= SUGGESTION_CONFIG.cache.ttlMs) {
    cache.delete(songId);
    return null;
  }
  return entry.result;
}

function writeCache(songId: string, result: YoutubeSuggestion, now: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.at >= SUGGESTION_CONFIG.cache.ttlMs) cache.delete(key);
  }
  // O Map preserva a ordem de inserção: a primeira chave é a mais antiga.
  while (cache.size >= SUGGESTION_CONFIG.cache.maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.delete(songId);
  cache.set(songId, { at: now, result });
}

export const youtubeSuggestionService = {
  /**
   * Candidatos ranqueados para a música. Uma busca no worker por música a cada 10 min;
   * falha do worker → `YoutubeSearchUnavailableError` (502 `SEARCH_FAILED`), sem cache.
   */
  async forSong(id: string): Promise<YoutubeSuggestion> {
    const now = Date.now();
    const cached = readCache(id, now);
    if (cached) return cached;

    const song = await songRepository.findById(id);
    if (!song) throw new SongNotFoundError(id);

    let candidates: WorkerYoutubeCandidate[];
    try {
      candidates = await workerClient.searchYoutube(buildQuery(song));
    } catch (error) {
      if (env.NODE_ENV !== "test") {
        console.error(`[youtube-suggestion.service] search for song ${id} failed:`, error);
      }
      throw new YoutubeSearchUnavailableError();
    }

    const result = rank(song, candidates);
    writeCache(id, result, now);
    return result;
  },

  /** Esvazia o cache (testes; um reinício da API faz o mesmo). */
  clearCache(): void {
    cache.clear();
  },
};
