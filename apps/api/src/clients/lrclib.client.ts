import { createRequire } from "node:module";
import { z } from "zod";
import { env } from "../config/env.js";
import { LyricsProviderUnavailableError } from "../utils/errors.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

/** O LRCLIB pede um User-Agent identificando o projeto. */
export const LRCLIB_USER_AGENT = `cantor.ia/${version} (github.com/matheusopessoa/cantor.ia)`;

/**
 * Timeout por tentativa e espera antes de cada nova tentativa. O LRCLIB responde 503 com
 * frequência (4 de 11 músicas na Etapa 0 da sdd-011): falha passageira (rede, timeout, 429,
 * 5xx) é tentada de novo; o pior caso fica em ~19 s, no background do processamento.
 */
export const LRCLIB_CONFIG = {
  timeoutMs: 5_000,
  retryDelaysMs: [1_000, 3_000],
};

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const lrclibTrackSchema = z.object({
  id: z.number().int(),
  trackName: z.string(),
  artistName: z.string(),
  albumName: z.string().nullable().default(null),
  /** Segundos (float). */
  duration: z.number(),
  syncedLyrics: z.string().nullable().default(null),
  /** Letra só em texto (sdd-011): vale como candidata, o tempo vem do alinhamento. */
  plainLyrics: z.string().nullable().default(null),
});

export type LrclibTrack = z.infer<typeof lrclibTrackSchema>;

async function attempt(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": LRCLIB_USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(LRCLIB_CONFIG.timeoutMs),
    });
    if (!isTransient(response.status)) return response;
    await response.body?.cancel();
    return null;
  } catch {
    return null;   // rede fora, DNS, timeout
  }
}

/** GET com novas tentativas em falha passageira; esgotadas, "provedor indisponível". */
async function request(path: string): Promise<Response> {
  const url = `${env.LRCLIB_BASE_URL.replace(/\/$/, "")}${path}`;
  for (const delay of [0, ...LRCLIB_CONFIG.retryDelaysMs]) {
    if (delay > 0) await sleep(delay);
    const response = await attempt(url);
    if (response) return response;
  }
  throw new LyricsProviderUnavailableError();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LyricsProviderUnavailableError();
  }
}

/** Lista de faixas: itens fora do formato esperado são descartados, não derrubam a busca. */
async function readTracks(response: Response): Promise<LrclibTrack[]> {
  if (!response.ok) throw new LyricsProviderUnavailableError();

  const body = await readJson(response);
  if (!Array.isArray(body)) throw new LyricsProviderUnavailableError();

  return body.flatMap((item) => {
    const parsed = lrclibTrackSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Cliente HTTP do LRCLIB (https://lrclib.net): a busca pela letra (sdd-015, o caminho
 * principal) e fonte de letra nos bastidores da busca pelo vídeo (sdd-011). Falha de rede, 5xx
 * ou corpo inesperado → `LyricsProviderUnavailableError` (502); quem coleta as letras trata a
 * falha como "fonte sem letra".
 */
export const lrclibClient = {
  /** `GET /api/search?q=` (texto livre da busca pela letra, sdd-015). */
  async search(q: string): Promise<LrclibTrack[]> {
    const query = new URLSearchParams({ q });
    return readTracks(await request(`/api/search?${query.toString()}`));
  },

  /** `GET /api/get/{id}` (cadastro pela letra, sdd-015). `null` quando o LRCLIB responde 404. */
  async getById(id: number): Promise<LrclibTrack | null> {
    const response = await request(`/api/get/${id}`);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) throw new LyricsProviderUnavailableError();

    const parsed = lrclibTrackSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new LyricsProviderUnavailableError();
    return parsed.data;
  },

  /**
   * `GET /api/search?artist_name=&track_name=`. Itens fora do formato esperado são
   * descartados, não derrubam a busca.
   */
  async find({ artist, title }: { artist: string; title: string }): Promise<LrclibTrack[]> {
    const query = new URLSearchParams({ artist_name: artist, track_name: title });
    return readTracks(await request(`/api/search?${query.toString()}`));
  },
};
