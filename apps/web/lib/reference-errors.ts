import { formatDuration } from "./format";
import type { ReferenceErrorCode } from "./types";

export type ReferenceErrorTone = "danger" | "warning";

export interface ErrorCopy {
  tone: ReferenceErrorTone;
  title: string;
  body: string;
}

export type ReferenceErrorInput = ReferenceErrorCode | "INVALID_YOUTUBE_URL";

export interface ReferenceErrorContext {
  /** Duração da letra (LRCLIB). */
  songMs: number;
  /** Duração do áudio da tentativa (`referenceAudioMs`), quando a API informou. */
  audioMs: number | null;
}

const KNOWN_CODES: ReadonlySet<string> = new Set<ReferenceErrorInput>([
  "INVALID_YOUTUBE_URL",
  "VIDEO_UNAVAILABLE",
  "TOO_LONG",
  "DURATION_MISMATCH",
  "NO_VOICE",
  "DOWNLOAD_FAILED",
  "INVALID_AUDIO",
  "INTERNAL",
]);

/**
 * Texto de cada código de erro da referência, exatamente como na tabela "Erros da
 * referência" do readme do design system. Código desconhecido cai em `INTERNAL`.
 */
export function referenceErrorCopy(code: string, ctx: ReferenceErrorContext): ErrorCopy {
  const known = (KNOWN_CODES.has(code) ? code : "INTERNAL") as ReferenceErrorInput;

  switch (known) {
    case "INVALID_YOUTUBE_URL":
      return {
        tone: "danger",
        title: "Esse link não é do YouTube",
        body: "Cole o endereço de um vídeo, tipo youtu.be/… ou youtube.com/watch?v=…",
      };
    case "VIDEO_UNAVAILABLE":
      return {
        tone: "danger",
        title: "Esse vídeo não abre",
        body: "Ele é privado, tem restrição de idade ou foi removido. Tente outro link.",
      };
    case "TOO_LONG":
      return {
        tone: "warning",
        title: "Música longa demais",
        body: "O limite é 10 minutos. Procure a versão de estúdio.",
      };
    case "DURATION_MISMATCH": {
      const song = formatDuration(ctx.songMs);
      const body =
        ctx.audioMs === null
          ? `O áudio não tem a duração da letra (${song}). Procure a versão "official audio".`
          : `O vídeo tem ${formatDuration(ctx.audioMs)} e a letra, ${song}. Procure a versão "official audio".`;
      return { tone: "warning", title: "Duração não bate com a letra", body };
    }
    case "NO_VOICE":
      return {
        tone: "warning",
        title: "Não achamos voz nesse áudio",
        body: "Parece ser só instrumental. Use a versão original, com o cantor.",
      };
    case "DOWNLOAD_FAILED":
      return {
        tone: "danger",
        title: "O YouTube não deixou baixar",
        body: "Tente de novo em alguns minutos ou envie o arquivo de áudio.",
      };
    case "INVALID_AUDIO":
      return {
        tone: "danger",
        title: "Não conseguimos ler esse arquivo",
        body: "Envie um MP3, M4A, WAV, OGG ou FLAC de até 20 MB.",
      };
    case "INTERNAL":
    default:
      return {
        tone: "danger",
        title: "Deu ruim do nosso lado",
        body: "Tente de novo. Se continuar, envie o arquivo de áudio.",
      };
  }
}

/** Falha de rede ou resposta inesperada da API: nunca mostra `message` nem stack. */
export const API_UNAVAILABLE_COPY: ErrorCopy = {
  tone: "danger",
  title: "Não deu para falar com o servidor",
  body: "Confira se a API está no ar e tente de novo.",
};
