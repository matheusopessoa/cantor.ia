import { z } from "zod";
import { env } from "../config/env.js";
import { pitchTrackSchema, type PitchTrack } from "../utils/validators.js";

/** Códigos do worker (`apps/worker/app/errors.py`). */
export const WORKER_ERROR_CODES = [
  "too_large",
  "invalid_audio",
  "too_long",
  "no_voice",
  "invalid_video_id",
  "video_unavailable",
  "download_failed",
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

/** Demucs + crepe levam ~1–2 min por música em CPU; o download do YouTube, até 2 min. */
export const WORKER_TIMEOUTS_MS = {
  extract: 10 * 60_000,
  youtubeExtract: 12 * 60_000,
  youtubeAudio: 2 * 60_000,
} as const;

const AUDIO_CONTENT_TYPES = new Set(["audio/mp4", "audio/mpeg"]);

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

async function readTrack(response: Response, path: string): Promise<PitchTrack> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WorkerClientError("invalid_response", `worker answered ${path} with a non-JSON body`);
  }

  const parsed = pitchTrackSchema.safeParse(body);
  if (!parsed.success) {
    throw new WorkerClientError("invalid_response", `worker answered ${path} with an invalid PitchTrack`);
  }
  return parsed.data;
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
  /** `POST /extract` (multipart). O buffer só vive nesta chamada: nada vai para disco. */
  async extract(audio: Buffer, filename: string): Promise<PitchTrack> {
    const form = new FormData();
    // O Buffer do multipart nunca vem de um SharedArrayBuffer; o cast só satisfaz o BlobPart.
    form.append("file", new Blob([audio as Uint8Array<ArrayBuffer>]), filename);

    const response = await send("/extract", { method: "POST", body: form }, WORKER_TIMEOUTS_MS.extract);
    return readTrack(response, "/extract");
  },

  /** `POST /youtube/extract`. Só o `videoId` é enviado, nunca a URL colada. */
  async extractFromYoutube(videoId: string): Promise<PitchTrack> {
    const response = await send("/youtube/extract", json({ videoId }), WORKER_TIMEOUTS_MS.youtubeExtract);
    return readTrack(response, "/youtube/extract");
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

    const lengthHeader = response.headers.get("content-length");
    const contentLength = lengthHeader !== null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;

    return { stream: response.body, contentType, contentLength };
  },
};
