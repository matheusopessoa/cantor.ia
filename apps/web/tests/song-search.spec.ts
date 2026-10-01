import { describe, expect, it } from "vitest";
import { API_UNAVAILABLE_COPY } from "../lib/reference-errors";
import { DEFAULT_SEARCH_MODE, SEARCH_MODES, searchErrorCopy, videoFallback } from "../lib/song-search";

describe("SEARCH_MODES", () => {
  it("abre pela letra e cada modo tem aba e dica", () => {
    expect(DEFAULT_SEARCH_MODE).toBe("lyrics");
    expect(SEARCH_MODES.lyrics.tab).toBe("Pela letra");
    expect(SEARCH_MODES.video.tab).toBe("Pelo vídeo");
    expect(SEARCH_MODES.video.hint).toMatch(/demora mais/);
  });
});

describe("searchErrorCopy", () => {
  it("pela letra: LRCLIB fora e música sem letra sincronizada", () => {
    expect(searchErrorCopy("lyrics", "LYRICS_UNAVAILABLE")).toMatchObject({ tone: "warning", title: "A busca pela letra não respondeu" });
    expect(searchErrorCopy("lyrics", "NO_SYNCED_LYRICS")).toMatchObject({ tone: "warning", title: "Essa música não tem letra sincronizada" });
  });

  it("pelo vídeo: busca fora e vídeo sem dados", () => {
    expect(searchErrorCopy("video", "SEARCH_FAILED")).toMatchObject({ title: "A busca pelo vídeo não respondeu" });
    expect(searchErrorCopy("video", "VIDEO_UNAVAILABLE")).toMatchObject({ title: "Não deu para abrir essa música" });
  });

  it("código desconhecido, sem código ou de outro modo → servidor fora", () => {
    expect(searchErrorCopy("lyrics", null)).toBe(API_UNAVAILABLE_COPY);
    expect(searchErrorCopy("video", "WHATEVER")).toBe(API_UNAVAILABLE_COPY);
    expect(searchErrorCopy("video", "LYRICS_UNAVAILABLE")).toBe(API_UNAVAILABLE_COPY);
    expect(searchErrorCopy("lyrics", "SEARCH_FAILED")).toBe(API_UNAVAILABLE_COPY);
  });
});

describe("videoFallback", () => {
  it("pela letra: em destaque sem resultado ou com erro, discreto com resultados", () => {
    expect(videoFallback("lyrics", "empty")).toBe("prominent");
    expect(videoFallback("lyrics", "error")).toBe("prominent");
    expect(videoFallback("lyrics", "results")).toBe("subtle");
  });

  it("pelo vídeo: nunca", () => {
    expect(videoFallback("video", "empty")).toBeNull();
    expect(videoFallback("video", "error")).toBeNull();
    expect(videoFallback("video", "results")).toBeNull();
  });
});
