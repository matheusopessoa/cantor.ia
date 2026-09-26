import { createRequire } from "node:module";
import { z } from "zod";
import { env } from "../config/env.js";
import { LyricsProviderUnavailableError } from "../utils/errors.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

/** O LRCLIB pede um User-Agent identificando o projeto. */
export const LRCLIB_USER_AGENT = `cantor.ia/${version} (github.com/matheusopessoa/cantor.ia)`;

const TIMEOUT_MS = 5_000;

const lrclibTrackSchema = z.object({
  id: z.number().int(),
  trackName: z.string(),
  artistName: z.string(),
  albumName: z.string().nullable().default(null),
  /** Segundos (float). */
  duration: z.number(),
  syncedLyrics: z.string().nullable().default(null),
});

export type LrclibTrack = z.infer<typeof lrclibTrackSchema>;

async function request(path: string): Promise<Response> {
  const base = env.LRCLIB_BASE_URL.replace(/\/$/, "");
  try {
    return await fetch(`${base}${path}`, {
      headers: { "user-agent": LRCLIB_USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Rede fora, DNS, timeout: para quem chama é tudo "provedor indisponível".
    throw new LyricsProviderUnavailableError();
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LyricsProviderUnavailableError();
  }
}

/**
 * Cliente HTTP do LRCLIB (https://lrclib.net). Falha de rede, 5xx ou corpo inesperado →
 * `LyricsProviderUnavailableError` (502).
 */
export const lrclibClient = {
  /** `GET /api/search?q=`. Itens fora do formato esperado são descartados, não derrubam a busca. */
  async search(q: string): Promise<LrclibTrack[]> {
    const response = await request(`/api/search?q=${encodeURIComponent(q)}`);
    if (!response.ok) throw new LyricsProviderUnavailableError();

    const body = await readJson(response);
    if (!Array.isArray(body)) throw new LyricsProviderUnavailableError();

    return body.flatMap((item) => {
      const parsed = lrclibTrackSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  },

  /** `GET /api/get/{id}`. `null` quando o LRCLIB responde 404. */
  async getById(id: number): Promise<LrclibTrack | null> {
    const response = await request(`/api/get/${id}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new LyricsProviderUnavailableError();

    const parsed = lrclibTrackSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new LyricsProviderUnavailableError();
    return parsed.data;
  },
};
