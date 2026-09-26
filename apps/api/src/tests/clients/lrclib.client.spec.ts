import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LRCLIB_CONFIG, lrclibClient } from "../../clients/lrclib.client.js";

const TRACK = { id: 1, trackName: "Olha", artistName: "Tim Bernardes", albumName: null, duration: 260, syncedLyrics: null, plainLyrics: "Olha" };

/** `fetch` falso que devolve, em ordem, cada resposta da lista (`Error` = falha de rede). */
function stubFetch(...responses: (number | Error)[]) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      const next = responses.shift() ?? 200;
      if (next instanceof Error) throw next;
      return new Response(next === 200 ? JSON.stringify([TRACK]) : "fora", { status: next });
    }),
  );
  return urls;
}

const originalDelays = LRCLIB_CONFIG.retryDelaysMs;

beforeEach(() => {
  LRCLIB_CONFIG.retryDelaysMs = [0, 0];
});

afterEach(() => {
  LRCLIB_CONFIG.retryDelaysMs = originalDelays;
  vi.unstubAllGlobals();
});

describe("lrclibClient.find", () => {
  it("busca por artista e título", async () => {
    const urls = stubFetch(200);

    expect(await lrclibClient.find({ artist: "Tim Bernardes", title: "Olha" })).toEqual([TRACK]);
    expect(urls[0]).toMatch(/\/api\/search\?artist_name=Tim\+Bernardes&track_name=Olha$/);
  });

  it("503 e falha de rede são tentados de novo", async () => {
    const urls = stubFetch(503, new TypeError("fetch failed"), 200);

    expect(await lrclibClient.find({ artist: "Tim Bernardes", title: "Olha" })).toEqual([TRACK]);
    expect(urls).toHaveLength(3);
  });

  it("esgotadas as tentativas → LyricsProviderUnavailableError", async () => {
    const urls = stubFetch(503, 502, 429);

    await expect(lrclibClient.find({ artist: "a", title: "b" })).rejects.toMatchObject({ name: "LyricsProviderUnavailableError", statusCode: 502 });
    expect(urls).toHaveLength(3);
  });

  it("4xx que não é 429 não é tentado de novo", async () => {
    const urls = stubFetch(404);

    await expect(lrclibClient.find({ artist: "a", title: "b" })).rejects.toMatchObject({ name: "LyricsProviderUnavailableError" });
    expect(urls).toHaveLength(1);
  });
});

describe("lrclibClient.search (busca pela letra, sdd-015)", () => {
  it("monta ?q= e descarta itens fora do formato", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        urls.push(String(url));
        return new Response(JSON.stringify([TRACK, { id: "x" }, null]), { status: 200 });
      }),
    );

    expect(await lrclibClient.search("tim bernardes olha")).toEqual([TRACK]);
    expect(urls[0]).toMatch(/\/api\/search\?q=tim\+bernardes\+olha$/);
  });

  it("LRCLIB fora depois das novas tentativas → LYRICS_UNAVAILABLE", async () => {
    stubFetch(503, 503, 503);

    await expect(lrclibClient.search("olha")).rejects.toMatchObject({ statusCode: 502, code: "LYRICS_UNAVAILABLE" });
  });
});

describe("lrclibClient.getById (cadastro pela letra, sdd-015)", () => {
  function stubTrack(...statuses: number[]) {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        urls.push(String(url));
        const status = statuses.shift() ?? 200;
        return new Response(status === 200 ? JSON.stringify(TRACK) : "fora", { status });
      }),
    );
    return urls;
  }

  it("devolve a faixa", async () => {
    const urls = stubTrack(200);

    expect(await lrclibClient.getById(1)).toEqual(TRACK);
    expect(urls[0]).toMatch(/\/api\/get\/1$/);
  });

  it("404 → null, sem nova tentativa", async () => {
    const urls = stubTrack(404);

    expect(await lrclibClient.getById(999)).toBeNull();
    expect(urls).toHaveLength(1);
  });

  it("503 passa pelas novas tentativas", async () => {
    const urls = stubTrack(503, 200);

    expect(await lrclibClient.getById(1)).toEqual(TRACK);
    expect(urls).toHaveLength(2);
  });

  it("corpo fora do formato → LyricsProviderUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })));

    await expect(lrclibClient.getById(1)).rejects.toMatchObject({ name: "LyricsProviderUnavailableError" });
  });
});
