const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Hosts exatos. Nada de `endsWith`: `youtube.com.evil.com` tem que ser recusado. */
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const SHORT_HOST = "youtu.be";

/**
 * Extrai o `videoId` de um link do YouTube. Só o id segue para o worker: a URL original
 * nunca é guardada nem repassada (regra 11 da sdd-003).
 *
 * Aceita `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/shorts/<id>` e
 * `youtube.com/embed/<id>` em `http`/`https`, ignorando os demais parâmetros (`t`, `list`,
 * `si`). Qualquer outra coisa → `null`.
 */
export function parseYoutubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | null | undefined;

  if (host === SHORT_HOST) {
    candidate = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") {
      candidate = url.searchParams.get("v");
    } else if (segments[0] === "shorts" || segments[0] === "embed") {
      candidate = segments[1];
    }
  }

  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}
