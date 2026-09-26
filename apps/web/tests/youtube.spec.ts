import { describe, expect, it } from "vitest";
import { youtubeSearchUrl, youtubeShortUrl, youtubeThumbnailUrl } from "../lib/youtube";

describe("youtubeSearchUrl", () => {
  it("monta a busca com 'official audio' e o termo codificado", () => {
    const url = new URL(youtubeSearchUrl("Legião Urbana", "Tempo Perdido"));
    expect(url.origin + url.pathname).toBe("https://www.youtube.com/results");
    expect(url.searchParams.get("search_query")).toBe("Legião Urbana Tempo Perdido official audio");
  });

  it("codifica acentos, & e aspas", () => {
    const url = youtubeSearchUrl("Simon & Garfunkel", 'The "Sound"');
    expect(url).toContain("Simon%20%26%20Garfunkel");
    expect(url).toContain("%22Sound%22");
    expect(youtubeSearchUrl("Léo", "Canção")).toContain("L%C3%A9o%20Can%C3%A7%C3%A3o");
  });

  it("normaliza espaços repetidos", () => {
    expect(new URL(youtubeSearchUrl("  A  ", " B ")).searchParams.get("search_query")).toBe("A B official audio");
  });
});

describe("youtubeThumbnailUrl", () => {
  it("usa default.jpg na busca e hqdefault.jpg na TV", () => {
    expect(youtubeThumbnailUrl("dQw4w9WgXcQ", "default")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg");
    expect(youtubeThumbnailUrl("dQw4w9WgXcQ", "hq")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });

  it("codifica o id", () => {
    expect(youtubeThumbnailUrl("a/b", "default")).toBe("https://i.ytimg.com/vi/a%2Fb/default.jpg");
  });
});

describe("youtubeShortUrl", () => {
  it("monta o endereço curto da legenda", () => {
    expect(youtubeShortUrl("dQw4w9WgXcQ")).toBe("youtu.be/dQw4w9WgXcQ");
  });
});
