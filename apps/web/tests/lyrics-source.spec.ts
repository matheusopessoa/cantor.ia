import { describe, expect, it } from "vitest";
import { AUTOMATIC_LYRICS_COPY, lyricsSourceNotice, REVIEWED_LYRICS_COPY } from "../lib/lyrics-source";

describe("lyricsSourceNotice", () => {
  it("letra da transcrição (whisper) avisa", () => {
    expect(lyricsSourceNotice({ source: "whisper", wer: null, candidates: [] })).toBe(AUTOMATIC_LYRICS_COPY);
  });

  it("letra da transcrição já revisada pelo MCP avisa que foi revisada (sdd-012)", () => {
    expect(lyricsSourceNotice({ source: "whisper", wer: null, candidates: [], reviewedAt: "2026-09-26T10:00:00.000Z" })).toBe(REVIEWED_LYRICS_COPY);
    expect(REVIEWED_LYRICS_COPY.title).toBe("Letra gerada automaticamente e revisada");
  });

  it("letra de site ou música antiga não avisa, mesmo revisada", () => {
    expect(lyricsSourceNotice({ source: "ytmusic", wer: 0.05, candidates: [{ source: "ytmusic", wer: 0.05 }] })).toBeNull();
    expect(lyricsSourceNotice({ source: "lrclib", wer: 0.1, candidates: [{ source: "lrclib", wer: 0.1 }], reviewedAt: "2026-09-26T10:00:00.000Z" })).toBeNull();
    expect(lyricsSourceNotice(null)).toBeNull();
  });
});
