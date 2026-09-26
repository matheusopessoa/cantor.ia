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
