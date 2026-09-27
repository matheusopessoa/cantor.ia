export class AppError extends Error {
  /**
   * @param code Código estável para o cliente escolher a mensagem (o web nunca usa o
   *   `message`). Quando presente, o error handler responde `{ message, code }`.
   */
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UserAlreadyExistsError extends AppError {
  constructor(email: string) {
    super(`User with email "${email}" already exists`, 409);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super(`Unauthorized for this action`, 401)
  }
}

export class InvalidEnvironmentError extends AppError {
  constructor(issues: Record<string, string[] | undefined>) {
    const details = Object.entries(issues)
      .map(([variable, messages]) => `${variable} (${messages?.join(", ")})`)
      .join("; ");

    super(`Invalid environment variables: ${details}`, 500);
  }
}

export class InvalidReferenceError extends AppError {
  constructor() {
    super("Reference track has no voiced frames", 422);
  }
}

// ─── Músicas e referência (sdd-003) ─────────────────────────────────────────

export class SongNotFoundError extends AppError {
  constructor(id: string | number) {
    super(`Song "${id}" not found`, 404);
  }
}

export class ReferenceAlreadyProcessingError extends AppError {
  constructor() {
    super("Reference is already being processed", 409);
  }
}

export class ReferenceAlreadyReadyError extends AppError {
  constructor() {
    super("Reference is already ready", 409);
  }
}

export class ReferenceNotReadyError extends AppError {
  constructor() {
    super("Reference is not ready", 409, "REFERENCE_NOT_READY");
  }
}

/** LRCLIB fora do ar, mesmo depois das novas tentativas do cliente (`LRCLIB_CONFIG`). */
export class LyricsProviderUnavailableError extends AppError {
  constructor() {
    super("Lyrics provider is unavailable", 502, "LYRICS_UNAVAILABLE");
  }
}

/** Faixa do LRCLIB sem letra sincronizada utilizável: não entra pela busca da letra (sdd-015). */
export class SongWithoutSyncedLyricsError extends AppError {
  constructor(lrclibId: number) {
    super(`LRCLIB track ${lrclibId} has no synced lyrics`, 422, "NO_SYNCED_LYRICS");
  }
}

export class InvalidYoutubeUrlError extends AppError {
  constructor() {
    super("Not a YouTube video URL", 400, "INVALID_YOUTUBE_URL");
  }
}

export class SongAudioUnavailableError extends AppError {
  constructor() {
    super("Song audio is unavailable: reference not ready or not from YouTube", 404);
  }
}

export class AudioProviderUnavailableError extends AppError {
  constructor() {
    super("Could not fetch the song audio", 502, "DOWNLOAD_FAILED");
  }
}

export class MissingUploadFileError extends AppError {
  constructor() {
    super('Send the audio file in the multipart field "file"', 400);
  }
}

/**
 * O YouTube Music não conhece o vídeo escolhido, ou não respondeu, no cadastro (sdd-011): sem
 * artista, título e duração não há como cadastrar.
 */
export class VideoMetadataUnavailableError extends AppError {
  constructor(videoId: string) {
    super(`Could not read the metadata of video "${videoId}" on YouTube Music`, 502, "VIDEO_UNAVAILABLE");
  }
}

/**
 * Busca no YouTube (sdd-008) ou no YouTube Music (a busca de músicas, sdd-011) falhou no
 * worker.
 */
export class YoutubeSearchUnavailableError extends AppError {
  constructor() {
    super("YouTube search is unavailable", 502, "SEARCH_FAILED");
  }
}

// ─── Voz do cantor: trilhas separadas (sdd-013) ──────────────────────────────

/** O worker está fora, passou do tempo ou respondeu algo inesperado ao separar as trilhas. */
export class StemsUnavailableError extends AppError {
  constructor() {
    super("Could not separate the song into vocals and instrumental", 502, "STEMS_UNAVAILABLE");
  }
}

/** Códigos de arquivo do worker que valem para o áudio enviado ao `/stems`. */
export const STEMS_AUDIO_REJECTIONS = {
  too_large: { statusCode: 413, code: "TOO_LARGE" },
  invalid_audio: { statusCode: 415, code: "INVALID_AUDIO" },
  too_long: { statusCode: 422, code: "TOO_LONG" },
} as const;
export type StemsAudioRejection = keyof typeof STEMS_AUDIO_REJECTIONS;

/** O worker recusou o áudio enviado (grande, ilegível ou longo demais): 413/415/422, como no upload da referência. */
export class StemsAudioRejectedError extends AppError {
  constructor(reason: StemsAudioRejection) {
    const { statusCode, code } = STEMS_AUDIO_REJECTIONS[reason];
    super(`Worker rejected the audio for stems separation: ${reason}`, statusCode, code);
  }
}

/**
 * A música não tem trilhas guardadas (sdd-016): anterior à sdd-016, não `READY`, gravar falhou
 * ou o arquivo sumiu da pasta. O web cai no fluxo da sdd-013 (`POST /:id/stems`).
 */
export class StemsNotStoredError extends AppError {
  constructor() {
    super("Song has no stored stems", 404, "STEMS_NOT_STORED");
  }
}

// ─── Revisão da letra pelo MCP (sdd-012) ─────────────────────────────────────

/** `/api/review/*` sem o `Authorization: Bearer <LYRICS_REVIEW_SECRET>` certo. */
export class ReviewUnauthorizedError extends AppError {
  constructor() {
    super("Missing or invalid review token", 401, "UNAUTHORIZED");
  }
}

/** `LYRICS_REVIEW_SECRET` não configurada no servidor: a revisão fica desligada. */
export class ReviewDisabledError extends AppError {
  constructor() {
    super("Lyrics review is disabled: LYRICS_REVIEW_SECRET is not set", 503, "REVIEW_DISABLED");
  }
}

/** A conferência precisa do áudio, que só existe para referência pelo YouTube (regra 6). */
export class ReviewNeedsVideoError extends AppError {
  constructor() {
    super("Lyrics review needs a YouTube reference: uploaded audio is not kept", 409, "REVIEW_NEEDS_VIDEO");
  }
}

/** `checkId` desconhecido ou com mais de 30 min (ou a API reiniciou): conferir de novo. */
export class ReviewCheckExpiredError extends AppError {
  constructor() {
    super("Lyrics check not found or expired: run the check again", 410, "REVIEW_CHECK_EXPIRED");
  }
}

/** A letra mudou (redo ou outra revisão) entre a conferência e a aplicação. */
export class LyricsChangedError extends AppError {
  constructor() {
    super("Lyrics changed since the check: run the check again", 409, "LYRICS_CHANGED");
  }
}

/** O worker não conseguiu alinhar a proposta (fora do ar, download falhou…). */
export class AlignmentUnavailableError extends AppError {
  constructor() {
    super("Could not align the proposed lyrics on the audio", 502, "ALIGN_FAILED");
  }
}
