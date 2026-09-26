import { API_UNAVAILABLE_COPY, type ErrorCopy } from "./reference-errors";

/**
 * Os dois caminhos da busca (sdd-015): pela letra (LRCLIB, o principal: letra sincronizada, sem
 * transcrição, prepara mais rápido) e pelo vídeo (YouTube Music, sdd-011: para o que o LRCLIB
 * não tem; a letra vem dos sites ou da voz).
 */
export type SearchMode = "lyrics" | "video";

/** A tela sempre abre pela letra; o modo não é lembrado (regra 1 da sdd-015). */
export const DEFAULT_SEARCH_MODE: SearchMode = "lyrics";

export const SEARCH_MODES: Record<SearchMode, { tab: string; hint: string }> = {
  lyrics: {
    tab: "Pela letra",
    hint: "Busque pelo nome da música ou do artista. Aparecem as músicas com letra sincronizada.",
  },
  video: {
    tab: "Pelo vídeo",
    hint: "Para o que não aparece pela letra. A letra vem dos sites ou da voz, e a preparação demora mais.",
  },
};

const LYRICS_UNAVAILABLE_COPY: ErrorCopy = {
  tone: "warning",
  title: "A busca pela letra não respondeu",
  body: "O LRCLIB está fora do ar agora. Tente de novo em instantes ou procure pelo vídeo.",
};

const NO_SYNCED_LYRICS_COPY: ErrorCopy = {
  tone: "warning",
  title: "Essa música não tem letra sincronizada",
  body: "Procure pelo vídeo: a letra vem dos sites ou da voz.",
};

const SEARCH_FAILED_COPY: ErrorCopy = {
  tone: "warning",
  title: "A busca pelo vídeo não respondeu",
  body: "O YouTube Music não respondeu agora. Tente de novo em instantes.",
};

const VIDEO_UNAVAILABLE_COPY: ErrorCopy = {
  tone: "warning",
  title: "Não deu para abrir essa música",
  body: "O YouTube Music não trouxe os dados dela. Tente outro resultado ou outra versão.",
};

/** Texto do erro ao buscar ou cadastrar, pelo modo e pelo `code` da API. */
export function searchErrorCopy(mode: SearchMode, code: string | null): ErrorCopy {
  if (mode === "lyrics") {
    if (code === "LYRICS_UNAVAILABLE") return LYRICS_UNAVAILABLE_COPY;
    if (code === "NO_SYNCED_LYRICS") return NO_SYNCED_LYRICS_COPY;
  } else {
    if (code === "SEARCH_FAILED") return SEARCH_FAILED_COPY;
    if (code === "VIDEO_UNAVAILABLE") return VIDEO_UNAVAILABLE_COPY;
  }
  return API_UNAVAILABLE_COPY;
}

/**
 * Oferecer "Procurar pelo vídeo"? Só na aba da letra: em destaque quando ela não achou nada ou
 * falhou (regra 6), discreto abaixo dos resultados (a versão certa pode não estar lá).
 */
export function videoFallback(mode: SearchMode, state: "empty" | "error" | "results"): "prominent" | "subtle" | null {
  if (mode === "video") return null;
  return state === "results" ? "subtle" : "prominent";
}
