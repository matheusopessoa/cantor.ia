import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerClientError, workerClient } from "../../clients/worker.client.js";
import { KNOWN_LYRICS, melody } from "../helpers/songs.js";
import { forcedFrom } from "../helpers/tracks.js";

/** `fetch` falso: registra a requisição e devolve `body` como JSON com o `status` dado. */
function stubFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workerClient.extractFromYoutube (sdd-010)", () => {
  it("envia videoId e a letra, e separa a curva do alinhamento", async () => {
    const forced = forcedFrom(melody.lines);
    const calls = stubFetch({ ...melody.track, alignment: forced });

    const result = await workerClient.extractFromYoutube("dQw4w9WgXcQ", KNOWN_LYRICS);

    expect(result).toEqual({ track: melody.track, alignment: forced, lyrics: null, transcript: null });
    expect(calls[0]?.url).toMatch(/\/youtube\/extract$/);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ videoId: "dQw4w9WgXcQ", lyrics: melody.lines });
  });

  it("alignment ausente ou null → null (worker sem alinhador ou letra sem texto)", async () => {
    stubFetch(melody.track);
    expect((await workerClient.extractFromYoutube("dQw4w9WgXcQ", KNOWN_LYRICS)).alignment).toBeNull();

    stubFetch({ ...melody.track, alignment: null });
    expect((await workerClient.extractFromYoutube("dQw4w9WgXcQ", KNOWN_LYRICS)).alignment).toBeNull();
  });

  it.each([
    ["model desconhecido", { version: 1, model: "whisper", frameMs: 20, lines: [] }],
    ["frameMs errado", { version: 1, model: "mms_fa", frameMs: 10, lines: [] }],
    ["score fora de 0..1", { version: 1, model: "mms_fa", frameMs: 20, lines: [{ index: 0, startMs: 0, endMs: 10, score: 1.5 }] }],
    ["startMs negativo", { version: 1, model: "mms_fa", frameMs: 20, lines: [{ index: 0, startMs: -20, endMs: 10, score: 0.5 }] }],
    ["não é objeto", "texto"],
  ])("alignment inválido (%s) → invalid_response", async (_label, alignment) => {
    stubFetch({ ...melody.track, alignment });

    await expect(workerClient.extractFromYoutube("dQw4w9WgXcQ", KNOWN_LYRICS)).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "invalid_response",
    });
  });

  it("erro do worker invalid_lyrics chega como WorkerClientError com o código", async () => {
    stubFetch({ error: "invalid_lyrics", message: "lyrics precisa ser..." }, 400);

    await expect(workerClient.extractFromYoutube("dQw4w9WgXcQ", KNOWN_LYRICS)).rejects.toEqual(
      new WorkerClientError("invalid_lyrics", "lyrics precisa ser..."),
    );
  });
});

describe("workerClient.extract (sdd-010)", () => {
  it("manda a letra no campo lyrics do multipart, antes do arquivo", async () => {
    const calls = stubFetch({ ...melody.track, alignment: null });

    const result = await workerClient.extract(Buffer.from("audio"), "musica.mp3", KNOWN_LYRICS);

    expect(result).toEqual({ track: melody.track, alignment: null, lyrics: null, transcript: null });
    const form = calls[0]?.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()]).toEqual(["lyrics", "file"]);
    expect(JSON.parse(String(form.get("lyrics")))).toEqual(melody.lines);
    expect((form.get("file") as File).name).toBe("musica.mp3");
  });
});

describe("sdd-011: candidatas de letra e YouTube Music", () => {
  const candidates = [{ source: "ytmusic" as const, lines: [{ text: "Olha", startMs: null }] }];
  const input = { kind: "candidates" as const, candidates, prompt: "Tim Bernardes - Olha" };
  const selected = {
    source: "ytmusic",
    wer: 0.05,
    candidates: [{ source: "ytmusic", wer: 0.05 }],
    lines: [{ text: "Olha", startMs: 960 }],
  };

  it("extractFromYoutube manda lyricsCandidates + lyricsPrompt e devolve a letra escolhida", async () => {
    const calls = stubFetch({ ...melody.track, alignment: null, lyrics: selected });

    const result = await workerClient.extractFromYoutube("dQw4w9WgXcQ", input);

    expect(result.lyrics).toEqual(selected);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      videoId: "dQw4w9WgXcQ",
      lyricsCandidates: candidates,
      lyricsPrompt: "Tim Bernardes - Olha",
    });
  });

  it("extract manda as candidatas em JSON e o prompt como texto no multipart", async () => {
    const calls = stubFetch({ ...melody.track, alignment: null, lyrics: selected });

    await workerClient.extract(Buffer.from("audio"), "musica.mp3", input);

    const form = calls[0]?.init.body as FormData;
    expect([...form.keys()]).toEqual(["lyricsCandidates", "lyricsPrompt", "file"]);
    expect(JSON.parse(String(form.get("lyricsCandidates")))).toEqual(candidates);
    expect(form.get("lyricsPrompt")).toBe("Tim Bernardes - Olha");
  });

  it.each([
    ["fonte desconhecida", { ...selected, source: "genius" }],
    ["linha sem startMs", { ...selected, lines: [{ text: "Olha" }] }],
    ["wer negativo", { ...selected, wer: -1 }],
  ])("letra escolhida inválida (%s) → invalid_response", async (_label, lyrics) => {
    stubFetch({ ...melody.track, alignment: null, lyrics });

    await expect(workerClient.extractFromYoutube("dQw4w9WgXcQ", input)).rejects.toMatchObject({ code: "invalid_response" });
  });

  const song = {
    videoId: "lB0FNP4o02U",
    title: "Tanto Faz",
    artist: "Tim Bernardes",
    album: "Recomeçar",
    durationS: 197,
    lyrics: { status: "none", source: null, lines: [] },
  };

  it("searchYtmusic pede a busca sem letra e devolve as músicas", async () => {
    const calls = stubFetch({ songs: [song] });

    expect(await workerClient.searchYtmusic("tim bernardes")).toEqual([song]);
    expect(calls[0]?.url).toMatch(/\/ytmusic\/search$/);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ query: "tim bernardes", withLyrics: false });
  });

  it("getYtmusicSong devolve metadados e letra; erro do worker vira WorkerClientError", async () => {
    const calls = stubFetch(song);
    expect(await workerClient.getYtmusicSong("lB0FNP4o02U")).toEqual(song);
    expect(calls[0]?.url).toMatch(/\/ytmusic\/song$/);

    stubFetch({ error: "video_unavailable", message: "não conhece" }, 422);
    await expect(workerClient.getYtmusicSong("lB0FNP4o02U")).rejects.toMatchObject({ code: "video_unavailable" });

    stubFetch({ ...song, videoId: "curto" });
    await expect(workerClient.getYtmusicSong("lB0FNP4o02U")).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("sdd-012: transcrição e conferência de revisão", () => {
  const transcript = [
    { text: "olá", startMs: 300, endMs: 500, probability: 0.9 },
    { text: "mundo", startMs: 600, endMs: 800, probability: 0.8 },
  ];
  const selected = { source: "whisper", wer: null, candidates: [], lines: [{ text: "olá mundo", startMs: 300 }] };
  const input = { kind: "candidates" as const, candidates: [], prompt: "A - B" };

  it("extractFromYoutube devolve as palavras do Whisper quando o worker manda", async () => {
    stubFetch({ ...melody.track, alignment: null, lyrics: selected, transcript });

    const result = await workerClient.extractFromYoutube("dQw4w9WgXcQ", input);

    expect(result.transcript).toEqual(transcript);
  });

  it.each([
    ["probabilidade fora de 0..1", [{ text: "olá", startMs: 0, endMs: 10, probability: 2 }]],
    ["startMs negativo", [{ text: "olá", startMs: -1, endMs: 10, probability: 0.5 }]],
    ["não é lista", "texto"],
  ])("transcript inválido (%s) → invalid_response", async (_label, bad) => {
    stubFetch({ ...melody.track, alignment: null, lyrics: selected, transcript: bad });

    await expect(workerClient.extractFromYoutube("dQw4w9WgXcQ", input)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("alignFromYoutube manda videoId, current e proposed e devolve os dois alinhamentos", async () => {
    const current = melody.lines;
    const proposed = melody.lines.map((line) => ({ ...line, text: `${line.text}!` }));
    const body = { durationMs: melody.track.durationMs, current: forcedFrom(current), proposed: forcedFrom(proposed) };
    const calls = stubFetch(body);

    const result = await workerClient.alignFromYoutube("dQw4w9WgXcQ", current, proposed);

    expect(result).toEqual(body);
    expect(calls[0]?.url).toMatch(/\/youtube\/align$/);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ videoId: "dQw4w9WgXcQ", current, proposed });
  });

  it("alignFromYoutube aceita alinhamentos nulos e recusa resposta sem durationMs", async () => {
    stubFetch({ durationMs: 1_000, current: null, proposed: null });
    expect(await workerClient.alignFromYoutube("dQw4w9WgXcQ", [], [])).toEqual({ durationMs: 1_000, current: null, proposed: null });

    stubFetch({ current: null, proposed: null });
    await expect(workerClient.alignFromYoutube("dQw4w9WgXcQ", [], [])).rejects.toMatchObject({ code: "invalid_response" });

    stubFetch({ error: "download_failed", message: "yt-dlp falhou" }, 502);
    await expect(workerClient.alignFromYoutube("dQw4w9WgXcQ", [], [])).rejects.toMatchObject({ code: "download_failed" });
  });
});

describe("workerClient.separateStems (sdd-013)", () => {
  const boundary = "cantor-stems-1";
  const multipart = `--${boundary}\r\nContent-Disposition: form-data; name="vocals"; filename="vocals.m4a"\r\nContent-Type: audio/mp4\r\n\r\nVOZ\r\n--${boundary}--\r\n`;

  function stubStems(body: BodyInit | null, headers: Record<string, string>, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return new Response(body, { status, headers });
      }),
    );
    return calls;
  }

  it("manda o arquivo no multipart e devolve o stream, o content-type com boundary e o content-length", async () => {
    const calls = stubStems(multipart, { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(multipart.length) });

    const result = await workerClient.separateStems(Buffer.from("audio"), "musica.m4a");

    expect(calls[0]?.url).toMatch(/\/stems$/);
    const form = calls[0]?.init.body as FormData;
    expect([...form.keys()]).toEqual(["file"]);
    expect((form.get("file") as File).name).toBe("musica.m4a");
    expect(result.contentType).toBe(`multipart/form-data; boundary=${boundary}`);
    expect(result.contentLength).toBe(multipart.length);
    expect(await new Response(result.stream).text()).toBe(multipart);
  });

  it.each([
    ["JSON", "application/json"],
    ["áudio solto", "audio/mp4"],
    ["multipart sem boundary", "multipart/form-data"],
  ])("resposta que não é multipart com boundary (%s) → invalid_response", async (_label, contentType) => {
    stubStems("{}", { "content-type": contentType });

    await expect(workerClient.separateStems(Buffer.from("audio"), "musica.m4a")).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "invalid_response",
    });
  });

  it("erro do worker (too_long) chega como WorkerClientError com o código", async () => {
    stubStems(JSON.stringify({ error: "too_long", message: "áudio com 700s" }), { "content-type": "application/json" }, 422);

    await expect(workerClient.separateStems(Buffer.from("audio"), "musica.m4a")).rejects.toEqual(
      new WorkerClientError("too_long", "áudio com 700s"),
    );
  });
});
