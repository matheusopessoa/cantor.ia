import type { ErrorCopy } from "./reference-errors";
import type { LyricsSelection } from "./types";

/** Letra escrita a partir da voz (sdd-011): canta e entra no ranking, mas com aviso. */
export const AUTOMATIC_LYRICS_COPY: ErrorCopy = {
  tone: "warning",
  title: "Letra gerada automaticamente",
  body: "Nenhum site tinha a letra desta gravação, então ela foi escrita a partir da voz e pode ter palavras erradas. A nota não muda: o tempo de cada verso vem do áudio.",
};

/** A mesma letra automática, depois de revisada pelo Claude Code (sdd-012): ainda pode ter erros, mas menos. */
export const REVIEWED_LYRICS_COPY: ErrorCopy = {
  tone: "warning",
  title: "Letra gerada automaticamente e revisada",
  body: "Nenhum site tinha a letra desta gravação, então ela foi escrita a partir da voz e depois revisada. Ainda pode ter alguma palavra errada. A nota não muda: o tempo de cada verso vem do áudio.",
};

/** Aviso sobre a origem da letra: só a transcrição da voz avisa (revisada ou não); letra de site não. */
export function lyricsSourceNotice(selection: LyricsSelection | null): ErrorCopy | null {
  if (selection?.source !== "whisper") return null;
  return selection.reviewedAt ? REVIEWED_LYRICS_COPY : AUTOMATIC_LYRICS_COPY;
}
