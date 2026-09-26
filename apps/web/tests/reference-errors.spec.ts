import { describe, expect, it } from "vitest";
import { referenceErrorCopy } from "../lib/reference-errors";

const ctx = { songMs: 238_000, audioMs: 272_000 };

describe("referenceErrorCopy (tabela do design system)", () => {
  it("INVALID_YOUTUBE_URL", () => {
    expect(referenceErrorCopy("INVALID_YOUTUBE_URL", ctx)).toEqual({
      tone: "danger",
      title: "Esse link não é do YouTube",
      body: "Cole o endereço de um vídeo, tipo youtu.be/… ou youtube.com/watch?v=…",
    });
  });

  it("VIDEO_UNAVAILABLE", () => {
    expect(referenceErrorCopy("VIDEO_UNAVAILABLE", ctx)).toEqual({
      tone: "danger",
      title: "Esse vídeo não abre",
      body: "Ele é privado, tem restrição de idade ou foi removido. Tente outro link.",
    });
  });

  it("TOO_LONG", () => {
    expect(referenceErrorCopy("TOO_LONG", ctx)).toEqual({
      tone: "warning",
      title: "Música longa demais",
      body: "O limite é 10 minutos. Procure a versão de estúdio.",
    });
  });

  it("DURATION_MISMATCH formata as duas durações em m:ss", () => {
    expect(referenceErrorCopy("DURATION_MISMATCH", ctx)).toEqual({
      tone: "warning",
      title: "Duração não bate com a letra",
      body: 'O vídeo tem 4:32 e a letra, 3:58. Procure a versão "official audio".',
    });
  });

  it("DURATION_MISMATCH sem a duração do áudio", () => {
    const copy = referenceErrorCopy("DURATION_MISMATCH", { songMs: 238_000, audioMs: null });
    expect(copy.tone).toBe("warning");
    expect(copy.body).toContain("3:58");
    expect(copy.body).not.toContain("null");
  });

  it("NO_VOICE", () => {
    expect(referenceErrorCopy("NO_VOICE", ctx)).toEqual({
      tone: "warning",
      title: "Não achamos voz nesse áudio",
      body: "Parece ser só instrumental. Use a versão original, com o cantor.",
    });
  });

  it("DOWNLOAD_FAILED", () => {
    expect(referenceErrorCopy("DOWNLOAD_FAILED", ctx)).toEqual({
      tone: "danger",
      title: "O YouTube não deixou baixar",
      body: "Tente de novo em alguns minutos ou envie o arquivo de áudio.",
    });
  });

  it("INVALID_AUDIO", () => {
    expect(referenceErrorCopy("INVALID_AUDIO", ctx)).toEqual({
      tone: "danger",
      title: "Não conseguimos ler esse arquivo",
      body: "Envie um MP3, M4A, WAV, OGG ou FLAC de até 20 MB.",
    });
  });

  it("INTERNAL", () => {
    expect(referenceErrorCopy("INTERNAL", ctx)).toEqual({
      tone: "danger",
      title: "Deu ruim do nosso lado",
      body: "Tente de novo. Se continuar, envie o arquivo de áudio.",
    });
  });

  it("código desconhecido cai em INTERNAL", () => {
    expect(referenceErrorCopy("WHATEVER", ctx)).toEqual(referenceErrorCopy("INTERNAL", ctx));
  });
});
