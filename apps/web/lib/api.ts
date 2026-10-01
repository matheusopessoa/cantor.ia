import { combinedProgress, type DownloadProgress } from "./download-progress";
import { publicEnv } from "./env.public";
import type {
  Difficulty,
  LyricsSearchItem,
  PerformanceBody,
  PerformanceResult,
  PitchTrack,
  RankingItem,
  ReferenceStarted,
  SongDto,
  SongSearchItem,
  YoutubeReferenceStarted,
  YoutubeSuggestion,
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

export type { DownloadProgress } from "./download-progress";

export interface ReferenceOptions {
  /** Refaz melodia e letra de uma referência já pronta (sdd-010). Sem isso, `READY` responde 409. */
  redo?: boolean;
}

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
 * Baixa um arquivo em streaming, avisando o progresso. `onProgress` recebe o total só quando
 * a API mandou `Content-Length`; sem ele, a tela mostra espera indeterminada. `signal` cancela
 * o download (sair da página no meio).
 */
async function downloadBlob(fileUrl: string, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(fileUrl, { cache: "no-store", signal });
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

    /** Cadastra pelo vídeo escolhido na busca e já começa a preparar (sdd-011). */
    async createSong(videoId: string): Promise<SongDto> {
      return parseJson(await fetch(url("/"), json({ videoId })));
    },

    /** Busca pela letra no LRCLIB (sdd-015): só músicas com letra sincronizada. */
    async searchLyrics(q: string): Promise<LyricsSearchItem[]> {
      const response = await fetch(url(`/search/lyrics?q=${encodeURIComponent(q)}`), { cache: "no-store" });
      return parseJson(response);
    },

    /** Cadastra pela letra (sdd-015). Não começa a preparar: o vídeo é escolhido na preparação. */
    async createSongFromLyrics(lrclibId: number): Promise<SongDto> {
      return parseJson(await fetch(url("/"), json({ lrclibId })));
    },

    async getSong(id: string): Promise<SongDto> {
      const response = await fetch(url(`/${encodeURIComponent(id)}`), { cache: "no-store" });
      return parseJson(response);
    },

    async setReferenceFromYoutube(id: string, youtubeUrl: string, { redo = false }: ReferenceOptions = {}): Promise<YoutubeReferenceStarted> {
      const body = redo ? { url: youtubeUrl, redo: true } : { url: youtubeUrl };
      return parseJson(await fetch(url(`/${encodeURIComponent(id)}/reference/youtube`), json(body)));
    },

    async uploadReference(id: string, file: File, { redo = false }: ReferenceOptions = {}): Promise<ReferenceStarted> {
      const form = new FormData();
      // Campos de texto ANTES do arquivo: é a única ordem em que a API os enxerga no multipart.
      if (redo) form.append("redo", "true");
      form.append("file", file, file.name);
      return parseJson(await fetch(url(`/${encodeURIComponent(id)}/reference`), { method: "POST", body: form }));
    },

    /** Candidatos do YouTube ranqueados (sdd-008). `signal` cancela ao sair da página. */
    async getYoutubeCandidates(id: string, signal?: AbortSignal): Promise<YoutubeSuggestion> {
      const response = await fetch(url(`/${encodeURIComponent(id)}/youtube-candidates`), { cache: "no-store", signal });
      return parseJson(response);
    },

    async getReference(id: string, signal?: AbortSignal): Promise<PitchTrack> {
      const response = await fetch(url(`/${encodeURIComponent(id)}/reference`), { cache: "no-store", signal });
      return parseJson(response);
    },

    /** Baixa o áudio para tocar (streaming, com progresso; ver `downloadBlob`). */
    downloadSongAudio(id: string, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<Blob> {
      return downloadBlob(url(`/${encodeURIComponent(id)}/audio`), onProgress, signal);
    },

    /**
     * As trilhas guardadas no servidor (sdd-016): voz e instrumental, dois GETs em paralelo com
     * o progresso somado. Só para música com `stemsKey`; 404 `STEMS_NOT_STORED` quando o
     * servidor não as tem (a tela cai no fluxo da sdd-013).
     */
    async downloadStems(id: string, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<{ vocals: Blob; instrumental: Blob }> {
      const [vocalsProgress, instrumentalProgress] = combinedProgress(2, onProgress);
      const [vocals, instrumental] = await Promise.all([
        downloadBlob(url(`/${encodeURIComponent(id)}/stems/vocals`), vocalsProgress, signal),
        downloadBlob(url(`/${encodeURIComponent(id)}/stems/instrumental`), instrumentalProgress, signal),
      ]);
      return { vocals, instrumental };
    },

    /**
     * Voz e instrumental do áudio que o browser já tem (sdd-013). Manda o próprio áudio
     * (multipart) e lê o `multipart/form-data` da API com `formData()`: dois arquivos, `vocals`
     * e `instrumental`. Leva 1–2 min (Demucs em CPU); `signal` cancela ao sair da página.
     */
    async separateStems(id: string, audio: Blob, signal?: AbortSignal): Promise<{ vocals: Blob; instrumental: Blob }> {
      const form = new FormData();
      form.append("file", audio, "musica");
      const response = await fetch(url(`/${encodeURIComponent(id)}/stems`), { method: "POST", body: form, signal });
      if (!response.ok) throw await toApiError(response);

      const parts = await response.formData();
      const vocals = parts.get("vocals");
      const instrumental = parts.get("instrumental");
      if (!(vocals instanceof Blob) || !(instrumental instanceof Blob) || vocals.size === 0 || instrumental.size === 0) {
        throw new ApiError(response.status, "Stems response without vocals and instrumental files");
      }
      return { vocals, instrumental };
    },

    async submitPerformance(id: string, body: PerformanceBody): Promise<PerformanceResult> {
      return parseJson(await fetch(url(`/${encodeURIComponent(id)}/performances`), json(body)));
    },

    /** Ranking de um nível (sdd-009). O nível é sempre explícito: o padrão da API (`HARD`) não é o do web. */
    async getRanking(id: string, limit: number, difficulty: Difficulty): Promise<RankingItem[]> {
      const query = `limit=${limit}&difficulty=${difficulty}`;
      const response = await fetch(url(`/${encodeURIComponent(id)}/performances?${query}`), {
        cache: "no-store",
      });
      return parseJson(response);
    },
  };
}

export type Api = ReturnType<typeof createApi>;

/** Cliente do browser. Nos Server Components use `serverApi` (`lib/api.server.ts`). */
export const api: Api = createApi(publicEnv.apiUrl);
