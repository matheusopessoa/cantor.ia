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

export class SongWithoutSyncedLyricsError extends AppError {
  constructor(lrclibId: number) {
    super(`LRCLIB track ${lrclibId} has no synced lyrics`, 422);
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
    super("Reference is not ready", 409);
  }
}

export class LyricsProviderUnavailableError extends AppError {
  constructor() {
    super("Lyrics provider is unavailable", 502);
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
