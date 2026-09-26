import type { YoutubeCandidateReason } from "./types";

/** Busca no YouTube sugerindo a versão de estúdio ("official audio"), como o plano pede. */
export function youtubeSearchUrl(artist: string, title: string): string {
  const query = `${artist} ${title} official audio`.replace(/\s+/g, " ").trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export type YoutubeThumbnailSize = "default" | "hq";

/** `default.jpg` (120×90) na linha da busca; `hqdefault.jpg` (480×360) na TV. */
export function youtubeThumbnailUrl(videoId: string, size: YoutubeThumbnailSize): string {
  const file = size === "hq" ? "hqdefault.jpg" : "default.jpg";
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${file}`;
}

/** Endereço curto para a legenda da TV (`youtu.be/<id>`). */
export function youtubeShortUrl(videoId: string): string {
  return `youtu.be/${videoId}`;
}

/** Link do vídeo: é o que "Usar este vídeo" manda para a rota atual de referência (sdd-008). */
export function youtubeWatchUrl(videoId: string): string {
  return `https://youtu.be/${encodeURIComponent(videoId)}`;
}

// ─── Sugestão de vídeo (sdd-008) ────────────────────────────────────────────

const BADGE_LABELS: Record<YoutubeCandidateReason, string> = {
  TOPIC_CHANNEL: "Áudio oficial",
  OFFICIAL_AUDIO: "Áudio oficial",
  ARTIST_CHANNEL: "Canal do artista",
  LYRIC_VIDEO: "Lyric video",
  OFFICIAL: "Oficial",
  MOST_VIEWED: "Mais visto",
  EXACT_DURATION: "Duração exata",
};

/** Ordem de exibição dos selos (do motivo mais forte para o mais fraco). */
const BADGE_ORDER: YoutubeCandidateReason[] = [
  "TOPIC_CHANNEL",
  "OFFICIAL_AUDIO",
  "ARTIST_CHANNEL",
  "LYRIC_VIDEO",
  "OFFICIAL",
  "MOST_VIEWED",
  "EXACT_DURATION",
];

export interface CandidateBadge {
  label: string;
}

/**
 * Selos em pt-BR para os motivos do candidato, sem repetir rótulo ("- Topic" e "official
 * audio" viram um só "Áudio oficial"). Motivos que o web não conhece são ignorados.
 */
export function candidateBadges(reasons: readonly string[]): CandidateBadge[] {
  const labels = new Set<string>();
  for (const reason of BADGE_ORDER) {
    if (reasons.includes(reason)) labels.add(BADGE_LABELS[reason]);
  }
  return [...labels].map((label) => ({ label }));
}

/** Visualizações abreviadas em pt-BR: 532, "1,5 mil", "830 mil", "1,2 mi", "12 mi", "1 bi". */
export function formatViews(views: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(views) ? views : 0));
  const short = (value: number) => {
    if (value >= 10) return String(Math.round(value));
    return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "").replace(".", ",");
  };

  if (n >= 999_500_000) return `${short(n / 1e9)} bi`;
  if (n >= 999_500) return `${short(n / 1e6)} mi`;
  if (n >= 999.5) return `${short(n / 1e3)} mil`;
  return String(n);
}
