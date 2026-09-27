import { z } from "zod";
import { env } from "../config/env.js";
import {
  forcedAlignmentSchema,
  pitchTrackSchema,
  selectedLyricsSchema,
  transcriptWordSchema,
  type ForcedAlignment,
  type LyricLine,
  type PitchTrack,
  type SelectedLyrics,
  type TranscriptWord,
} from "../utils/validators.js";

/** Códigos do worker (`apps/worker/app/errors.py`). */
export const WORKER_ERROR_CODES = [
  "too_large",
  "invalid_audio",
  "too_long",
  "no_voice",
  "invalid_video_id",
  "video_unavailable",
  "download_failed",
  "invalid_query",
  "search_failed",
  "invalid_lyrics",
  "internal",
] as const;
export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[number];

/** Os códigos do worker mais as falhas que acontecem antes de uma resposta válida chegar. */
export type WorkerClientErrorCode = WorkerErrorCode | "timeout" | "unreachable" | "invalid_response";

export class WorkerClientError extends Error {
  constructor(
    public readonly code: WorkerClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkerClientError";
  }
}

export interface WorkerAudio {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
}

/**
 * Resultado de `POST /stems` (sdd-013): o `multipart/form-data` do worker com os arquivos
 * `vocals` e `instrumental`, repassado ao browser como veio. `contentType` inclui o `boundary`.
 */
export interface WorkerStems {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
}

/** Um resultado da busca no YouTube (`POST /youtube/search`, sdd-008), sem download. */
export interface WorkerYoutubeCandidate {
  videoId: string;
  title: string;
  channel: string | null;
  durationS: number | null;
  viewCount: number | null;
  isLive: boolean;
}

/**
 * Demucs + crepe + Whisper levam ~2–3 min por música em CPU; o download do YouTube, até 2 min;
 * a busca no YouTube tem 20 s de timeout no worker e a do YouTube Music, 30 s (mais folga de
 * rede aqui).
 */
export const WORKER_TIMEOUTS_MS = {
  extract: 10 * 60_000,
  youtubeExtract: 12 * 60_000,
  /** Download + Demucs + 2 alinhamentos (sem crepe nem Whisper, sdd-012): ≤ 3 min em CPU. */
  youtubeAlign: 6 * 60_000,
  youtubeAudio: 2 * 60_000,
  /** Demucs + 2 codificações AAC (sdd-013): ≤ 2 min em CPU para uma música de 3–4 min. */
  stems: 5 * 60_000,
  youtubeSearch: 25_000,
  ytmusic: 35_000,
} as const;

/** Uma letra encontrada num site, candidata a ser a letra da música (sdd-011). */
export interface WorkerLyricsCandidate {
  source: "lrclib" | "ytmusic";
  lines: { text: string; startMs: number | null }[];
}

/**
 * A letra que vai com a extração: conhecida (música antiga, sdd-010: o worker só alinha) ou
 * candidatas (música nova, sdd-011: o worker transcreve a voz, escolhe e alinha a escolhida).
 * `prompt` ("artista - título") ajuda o Whisper na grafia de nomes.
 */
export type WorkerLyricsInput =
  | { kind: "known"; lines: LyricLine[] }
  | { kind: "candidates"; candidates: WorkerLyricsCandidate[]; prompt: string };

const ytmusicLyricsSchema = z.object({
  status: z.enum(["synced", "plain", "none", "error"]),
  source: z.string().nullable(),
  lines: z.array(
    z.object({
      text: z.string(),
      startMs: z.number().int().nonnegative().nullable(),
      endMs: z.number().int().nonnegative().nullable(),
    }),
  ),
});
export type WorkerYtmusicLyrics = z.infer<typeof ytmusicLyricsSchema>;

/** Uma música do YouTube Music (`POST /ytmusic/search` e `/ytmusic/song`, sdd-011). */
const ytmusicSongSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  durationS: z.number().nonnegative().nullable(),
  lyrics: ytmusicLyricsSchema,
});
export type WorkerYtmusicSong = z.infer<typeof ytmusicSongSchema>;

const ytmusicSearchSchema = z.object({ songs: z.array(ytmusicSongSchema).max(50) });

/** Tolerante de propósito (R1 da sdd-008): o YouTube nem sempre informa canal, duração ou visualizações. */
const workerYoutubeCandidateSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string(),
  channel: z.string().nullable().default(null),
  durationS: z.number().nonnegative().nullable().default(null),
  viewCount: z.number().int().nonnegative().nullable().default(null),
  isLive: z.boolean().default(false),
});

const workerYoutubeSearchSchema = z.object({ candidates: z.array(workerYoutubeCandidateSchema).max(50) });

const AUDIO_CONTENT_TYPES = new Set(["audio/mp4", "audio/mpeg"]);
const MULTIPART_CONTENT_TYPE = /^multipart\/form-data;\s*boundary=\S+$/i;

function contentLengthOf(response: Response): number | null {
  const header = response.headers.get("content-length");
  return header !== null && /^\d+$/.test(header) ? Number(header) : null;
}

const workerErrorSchema = z.object({ error: z.enum(WORKER_ERROR_CODES), message: z.string() });

function workerUrl(path: string): string {
  return `${env.WORKER_URL.replace(/\/$/, "")}${path}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function send(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(workerUrl(path), { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new WorkerClientError("timeout", `worker did not answer ${path} within ${timeoutMs} ms`);
    }
    throw new WorkerClientError("unreachable", `worker unreachable on ${path}: ${describe(error)}`);
  }

  if (!response.ok) throw await toClientError(response, path);
  return response;
}

async function toClientError(response: Response, path: string): Promise<WorkerClientError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // corpo não é JSON: cai no invalid_response abaixo
  }

  const parsed = workerErrorSchema.safeParse(body);
  if (parsed.success) return new WorkerClientError(parsed.data.error, parsed.data.message);
  return new WorkerClientError(
    "invalid_response",
    `worker answered ${response.status} on ${path} without an error body`,
  );
}

async function readJson<T>(response: Response, path: string, schema: z.ZodType<T, unknown>, label: string): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WorkerClientError("invalid_response", `worker answered ${path} with a non-JSON body`);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new WorkerClientError("invalid_response", `worker answered ${path} with an invalid ${label}`);
  }
  return parsed.data;
}

/** As duas trilhas em AAC (`.m4a`) que vêm com a extração quando ela pede `stems` (sdd-016). */
export interface WorkerStemFiles {
  vocals: Buffer;
  instrumental: Buffer;
}

/**
 * Resultado de `POST /extract` e `POST /youtube/extract`: a curva, o alinhamento da letra
 * (sdd-010) e, quando foram candidatas, a letra escolhida (sdd-011; o alinhamento é sobre ela).
 */
export interface WorkerExtraction {
  track: PitchTrack;
  /** `null` quando a letra não foi enviada, não tem texto alinhável ou o alinhador falhou no worker. */
  alignment: ForcedAlignment | null;
  /** `null` quando a letra foi enviada pronta (`kind: "known"`). */
  lyrics: SelectedLyrics | null;
  /** As palavras do Whisper (sdd-012); `null` quando a letra foi enviada pronta. */
  transcript: TranscriptWord[] | null;
  /** Voz e instrumental da mesma passada do Demucs (sdd-016); `null` quando não foram pedidas. */
  stems: WorkerStemFiles | null;
}

export interface WorkerExtractOptions {
  /** Pede as trilhas junto com a curva (sdd-016): a resposta vira `multipart/form-data`. */
  stems?: boolean;
}

/** Resultado de `POST /youtube/align` (sdd-012): a letra atual e a proposta sobre a mesma voz. */
export interface WorkerAlignment {
  durationMs: number;
  current: ForcedAlignment | null;
  proposed: ForcedAlignment | null;
}

const extractResponseSchema = pitchTrackSchema.extend({
  alignment: forcedAlignmentSchema.nullable().default(null),
  lyrics: selectedLyricsSchema.nullable().default(null),
  transcript: z.array(transcriptWordSchema).max(20_000).nullable().default(null),
});

const alignResponseSchema = z.object({
  durationMs: z.number().int().positive().max(600_000),
  current: forcedAlignmentSchema.nullable(),
  proposed: forcedAlignmentSchema.nullable(),
});

function parseExtraction(body: unknown, path: string, stems: WorkerStemFiles | null): WorkerExtraction {
  const parsed = extractResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new WorkerClientError("invalid_response", `worker answered ${path} with an invalid ExtractResponse`);
  }
  const { alignment, lyrics, transcript, ...track } = parsed.data;
  return { track, alignment, lyrics, transcript, stems };
}

async function stemPart(form: FormData, name: keyof WorkerStemFiles, path: string): Promise<Buffer> {
  const part = form.get(name);
  if (!(part instanceof Blob) || part.size === 0) {
    throw new WorkerClientError("invalid_response", `worker answered ${path} without a non-empty "${name}" part`);
  }
  return Buffer.from(await part.arrayBuffer());
}

/**
 * Com `stems` (sdd-016) o worker responde `multipart/form-data`: `result` (o JSON de sempre),
 * `vocals` e `instrumental`. As trilhas (~3 MB cada) ficam em memória só nesta chamada; quem
 * grava é o `stems.repository`.
 */
async function readExtractionWithStems(response: Response, path: string): Promise<WorkerExtraction> {
  let form: FormData;
  try {
    form = await response.formData();
  } catch {
    throw new WorkerClientError("invalid_response", `worker answered ${path} with an unreadable multipart body`);
  }
  const result = form.get("result");
  if (typeof result !== "string") {
    throw new WorkerClientError("invalid_response", `worker answered ${path} without a "result" part`);
  }
  let body: unknown;
  try {
    body = JSON.parse(result);
  } catch {
    throw new WorkerClientError("invalid_response", `worker answered ${path} with a non-JSON "result" part`);
  }
  const vocals = await stemPart(form, "vocals", path);
  const instrumental = await stemPart(form, "instrumental", path);
  return parseExtraction(body, path, { vocals, instrumental });
}

async function readExtraction(response: Response, path: string): Promise<WorkerExtraction> {
  const contentType = (response.headers.get("content-type") ?? "").trim();
  if (MULTIPART_CONTENT_TYPE.test(contentType)) return readExtractionWithStems(response, path);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WorkerClientError("invalid_response", `worker answered ${path} with a non-JSON body`);
  }
  return parseExtraction(body, path, null);
}

/** Campos da letra no corpo do worker: `lyrics` ou `lyricsCandidates` + `lyricsPrompt`. */
function lyricsFields(lyrics: WorkerLyricsInput): Record<string, unknown> {
  return lyrics.kind === "known"
    ? { lyrics: lyrics.lines }
    : { lyricsCandidates: lyrics.candidates, lyricsPrompt: lyrics.prompt };
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Cliente HTTP do worker de pitch (`apps/worker`, contrato em
 * `specs/sdd-001-worker-pitch/tasks.md` §4). Toda falha vira `WorkerClientError` com um
 * código; o `song.service.ts` traduz para `ReferenceErrorCode`.
 */
export const workerClient = {
  /**
   * `POST /extract` (multipart). O buffer só vive nesta chamada: nada vai para disco. A letra
   * vai junto (campos de texto JSON) para o worker alinhá-la (sdd-010) ou escolhê-la (sdd-011).
   * Com `stems` (sdd-016), o worker devolve também as duas trilhas.
   */
  async extract(audio: Buffer, filename: string, lyrics: WorkerLyricsInput, { stems = false }: WorkerExtractOptions = {}): Promise<WorkerExtraction> {
    const form = new FormData();
    for (const [name, value] of Object.entries(lyricsFields(lyrics))) {
      form.append(name, typeof value === "string" ? value : JSON.stringify(value));
    }
    if (stems) form.append("stems", "true");
    // O Buffer do multipart nunca vem de um SharedArrayBuffer; o cast só satisfaz o BlobPart.
    form.append("file", new Blob([audio as Uint8Array<ArrayBuffer>]), filename);

    const response = await send("/extract", { method: "POST", body: form }, WORKER_TIMEOUTS_MS.extract);
    return readExtraction(response, "/extract");
  },

  /** `POST /youtube/extract`. Só o `videoId` (e a letra) é enviado, nunca a URL colada. */
  async extractFromYoutube(videoId: string, lyrics: WorkerLyricsInput, { stems = false }: WorkerExtractOptions = {}): Promise<WorkerExtraction> {
    const body = { videoId, ...lyricsFields(lyrics), ...(stems ? { stems: true } : {}) };
    const response = await send("/youtube/extract", json(body), WORKER_TIMEOUTS_MS.youtubeExtract);
    return readExtraction(response, "/youtube/extract");
  },

  /**
   * `POST /youtube/align` (sdd-012): alinha a letra atual e a proposta de uma revisão sobre a
   * voz do vídeo, numa passada só do modelo. Nada é gravado no worker.
   */
  async alignFromYoutube(videoId: string, current: LyricLine[], proposed: LyricLine[]): Promise<WorkerAlignment> {
    const response = await send("/youtube/align", json({ videoId, current, proposed }), WORKER_TIMEOUTS_MS.youtubeAlign);
    return readJson(response, "/youtube/align", alignResponseSchema, "AlignResponse");
  },

  /**
   * `POST /youtube/audio`. Devolve o corpo como stream para a API repassar sem carregar o
   * arquivo inteiro em memória. Só aceita `audio/mp4` ou `audio/mpeg`.
   */
  async fetchYoutubeAudio(videoId: string): Promise<WorkerAudio> {
    const response = await send("/youtube/audio", json({ videoId }), WORKER_TIMEOUTS_MS.youtubeAudio);

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!AUDIO_CONTENT_TYPES.has(contentType) || response.body === null) {
      await response.body?.cancel();
      throw new WorkerClientError("invalid_response", `worker answered /youtube/audio with "${contentType}"`);
    }

    return { stream: response.body, contentType, contentLength: contentLengthOf(response) };
  },

  /**
   * `POST /stems` (sdd-013, multipart): separa o áudio que o browser já tem em voz e
   * instrumental. O buffer só vive nesta chamada, e a resposta (um `multipart/form-data` com
   * os dois arquivos) volta como stream para a API repassar sem carregar em memória. Só aceita
   * `multipart/form-data` com `boundary`.
   */
  async separateStems(audio: Buffer, filename: string): Promise<WorkerStems> {
    const form = new FormData();
    form.append("file", new Blob([audio as Uint8Array<ArrayBuffer>]), filename);

    const response = await send("/stems", { method: "POST", body: form }, WORKER_TIMEOUTS_MS.stems);

    const contentType = (response.headers.get("content-type") ?? "").trim();
    if (!MULTIPART_CONTENT_TYPE.test(contentType) || response.body === null) {
      await response.body?.cancel();
      throw new WorkerClientError("invalid_response", `worker answered /stems with "${contentType}"`);
    }

    return { stream: response.body, contentType, contentLength: contentLengthOf(response) };
  },

  /**
   * `POST /youtube/search` (sdd-008). A consulta é montada pela API a partir de artista e
   * título do LRCLIB, nunca de texto livre do usuário. Nada é baixado.
   */
  async searchYoutube(query: string): Promise<WorkerYoutubeCandidate[]> {
    const response = await send("/youtube/search", json({ query }), WORKER_TIMEOUTS_MS.youtubeSearch);
    const { candidates } = await readJson(response, "/youtube/search", workerYoutubeSearchSchema, "search result");
    return candidates;
  },

  /** `POST /ytmusic/search` (sdd-011): a busca de músicas do app, sem letra (mais rápida). */
  async searchYtmusic(query: string): Promise<WorkerYtmusicSong[]> {
    const response = await send("/ytmusic/search", json({ query, withLyrics: false }), WORKER_TIMEOUTS_MS.ytmusic);
    const { songs } = await readJson(response, "/ytmusic/search", ytmusicSearchSchema, "search result");
    return songs;
  },

  /** `POST /ytmusic/song` (sdd-011): metadados e letra de um vídeo. */
  async getYtmusicSong(videoId: string): Promise<WorkerYtmusicSong> {
    const response = await send("/ytmusic/song", json({ videoId }), WORKER_TIMEOUTS_MS.ytmusic);
    return readJson(response, "/ytmusic/song", ytmusicSongSchema, "song");
  },
};
