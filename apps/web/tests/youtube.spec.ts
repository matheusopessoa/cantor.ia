import { describe, expect, it } from "vitest";
import { candidateBadges, formatViews, youtubeSearchUrl, youtubeShortUrl, youtubeThumbnailUrl, youtubeWatchUrl } from "../lib/youtube";

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

describe("youtubeWatchUrl", () => {
  it("monta o link que 'Usar este vídeo' manda para a API", () => {
    expect(youtubeWatchUrl("dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
  });
});

describe("candidateBadges (sdd-008)", () => {
  it("traduz os motivos na ordem do mais forte para o mais fraco", () => {
    expect(candidateBadges(["EXACT_DURATION", "ARTIST_CHANNEL", "TOPIC_CHANNEL"])).toEqual([
      { label: "Áudio oficial" },
      { label: "Canal do artista" },
      { label: "Duração exata" },
    ]);
  });

  it("'- Topic' e 'official audio' viram um único 'Áudio oficial'", () => {
    expect(candidateBadges(["TOPIC_CHANNEL", "OFFICIAL_AUDIO"])).toEqual([{ label: "Áudio oficial" }]);
  });

  it("cobre todos os rótulos e ignora motivos desconhecidos", () => {
    expect(candidateBadges(["LYRIC_VIDEO", "OFFICIAL", "MOST_VIEWED", "FUTURE_CODE"])).toEqual([
      { label: "Lyric video" },
      { label: "Oficial" },
      { label: "Mais visto" },
    ]);
    expect(candidateBadges([])).toEqual([]);
  });
});

describe("formatViews", () => {
  it("abrevia em pt-BR", () => {
    expect(formatViews(532)).toBe("532");
    expect(formatViews(1_500)).toBe("1,5 mil");
    expect(formatViews(830_000)).toBe("830 mil");
    expect(formatViews(1_234_567)).toBe("1,2 mi");
    expect(formatViews(2_000_000)).toBe("2 mi");
    expect(formatViews(12_345_678)).toBe("12 mi");
    expect(formatViews(1_000_000_000)).toBe("1 bi");
  });

  it("arredonda para a unidade seguinte em vez de mostrar '1000 mil'", () => {
    expect(formatViews(999_950)).toBe("1 mi");
    expect(formatViews(9_999)).toBe("10 mil");
    expect(formatViews(1_000)).toBe("1 mil");
    expect(formatViews(999)).toBe("999");
  });

  it("negativos e NaN viram 0", () => {
    expect(formatViews(-5)).toBe("0");
    expect(formatViews(Number.NaN)).toBe("0");
  });
});
