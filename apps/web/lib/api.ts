import { publicEnv } from "./env.public";
import type {
  PerformanceBody,
  PerformanceResult,
  PitchTrack,
  RankingItem,
  ReferenceStarted,
  SongDto,
  SongSearchItem,
  YoutubeReferenceStarted,
} from "./types";

/**
 * Erro HTTP da API. A tela escolhe o texto pelo `code` (ou pelo `status`); `message`
 * existe só para log e nunca aparece para o usuário.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type DownloadProgress = (loaded: number, total: number | null) => void;

async function toApiError(response: Response): Promise<ApiError> {
  let message = response.statusText || `HTTP ${response.status}`;
  let code: string | undefined;

  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.message === "string") message = record.message;
      if (typeof record.code === "string") code = record.code;
    }
  } catch {
    // corpo não é JSON: fica o statusText
  }

  return new ApiError(response.status, message, code);
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

/**
 * Cliente tipado de `/api/songs/*` (sdd-003). `baseUrl` muda conforme quem chama: o
 * browser usa `NEXT_PUBLIC_API_URL`; os Server Components, `API_INTERNAL_URL`
 * (`lib/api.server.ts`), porque dentro do container `localhost` não é a API.
 */
export function createApi(baseUrl: string) {
  const url = (path: string) => `${baseUrl}/api/songs${path}`;
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    async searchSongs(q: string): Promise<SongSearchItem[]> {
      const response = await fetch(url(`/search?q=${encodeURIComponent(q)}`), { cache: "no-store" });
      return parseJson(response);
    },

    async createSong(lrclibId: number): Promise<SongDto> {
      return parseJson(await fetch(url("/"), json({ lrclibId })));
    },

    async getSong(id: string): Promise<SongDto> {
      const response = await fetch(url(`/${encodeURIComponent(id)}`), { cache: "no-store" });
      return parseJson(response);
    },

    async setReferenceFromYoutube(id: string, youtubeUrl: string): Promise<YoutubeReferenceStarted> {
      return parseJson(await fetch(url(`/${encodeURIComponent(id)}/reference/youtube`), json({ url: youtubeUrl })));
    },

    async uploadReference(id: string, file: File): Promise<ReferenceStarted> {
      const form = new FormData();
      form.append("file", file, file.name);
      return parseJson(await fetch(url(`/${encodeURIComponent(id)}/reference`), { method: "POST", body: form }));
    },

    async getReference(id: string, signal?: AbortSignal): Promise<PitchTrack> {
      const response = await fetch(url(`/${encodeURIComponent(id)}/reference`), { cache: "no-store", signal });
      return parseJson(response);
    },

    /**
     * Baixa o áudio para tocar (streaming). `onProgress` recebe o total só quando a API
     * mandou `Content-Length`; sem ele, a tela mostra espera indeterminada. `signal` cancela
     * o download (sair da página no meio).
     */
    async downloadSongAudio(id: string, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<Blob> {
      const response = await fetch(url(`/${encodeURIComponent(id)}/audio`), { cache: "no-store", signal });
      if (!response.ok) throw await toApiError(response);

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const lengthHeader = response.headers.get("content-length");
      const total = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;

      if (!response.body) {
        const blob = await response.blob();
        onProgress?.(blob.size, total ?? blob.size);
        return blob;
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      onProgress?.(0, total);

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(loaded, total);
      }

      return new Blob(chunks as BlobPart[], { type: contentType });
    },

    async submitPerformance(id: string, body: PerformanceBody): Promise<PerformanceResult> {
      return parseJson(await fetch(url(`/${encodeURIComponent(id)}/performances`), json(body)));
    },

    async getRanking(id: string, limit = 10): Promise<RankingItem[]> {
      const response = await fetch(url(`/${encodeURIComponent(id)}/performances?limit=${limit}`), {
        cache: "no-store",
      });
      return parseJson(response);
    },
  };
}

export type Api = ReturnType<typeof createApi>;

/** Cliente do browser. Nos Server Components use `serverApi` (`lib/api.server.ts`). */
export const api: Api = createApi(publicEnv.apiUrl);
