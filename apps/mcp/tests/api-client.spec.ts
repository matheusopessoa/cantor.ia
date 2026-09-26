import { describe, expect, it } from "vitest";
import { createReviewApi, REVIEW_API_TIMEOUTS_MS, ReviewApiError } from "../src/api-client.js";

interface Call {
  url: string;
  init: RequestInit;
}

/** `fetch` falso: registra a chamada e responde `body` (JSON) com o `status`, ou lança `failure`. */
function fakeFetch(body: unknown, status = 200, failure?: Error) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (failure) throw failure;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const SONG_ID = "019a0000-0000-7000-8000-000000000000";

function api(fetchFn: typeof fetch) {
  return createReviewApi({ baseUrl: "http://api.test/", secret: "s".repeat(32), fetch: fetchFn });
}

describe("createReviewApi", () => {
  it("manda o token no header Authorization em toda chamada e tira a barra final da URL", async () => {
    const { calls, fetchFn } = fakeFetch([]);

    await api(fetchFn).listSongs();

    expect(calls[0]?.url).toBe("http://api.test/api/review/songs");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(`Bearer ${"s".repeat(32)}`);
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("listSongs passa o limit na query", async () => {
    const { calls, fetchFn } = fakeFetch([{ id: SONG_ID }]);

    const songs = await api(fetchFn).listSongs(5);

    expect(songs).toEqual([{ id: SONG_ID }]);
    expect(calls[0]?.url).toBe("http://api.test/api/review/songs?limit=5");
  });

  it("getSong busca pelo id", async () => {
    const { calls, fetchFn } = fakeFetch({ id: SONG_ID });

    await api(fetchFn).getSong(SONG_ID);

    expect(calls[0]?.url).toBe(`http://api.test/api/review/songs/${SONG_ID}`);
  });

  it("check manda os versos em JSON com o timeout longo", async () => {
    const { calls, fetchFn } = fakeFetch({ checkId: "x" });

    await api(fetchFn).check(SONG_ID, ["a", "", "b"]);

    expect(calls[0]?.url).toBe(`http://api.test/api/review/songs/${SONG_ID}/check`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ lines: ["a", "", "b"] });
    expect(REVIEW_API_TIMEOUTS_MS.check).toBeGreaterThan(REVIEW_API_TIMEOUTS_MS.default);
  });

  it("apply manda o checkId", async () => {
    const { calls, fetchFn } = fakeFetch({ id: SONG_ID });

    await api(fetchFn).apply(SONG_ID, "abc");

    expect(calls[0]?.url).toBe(`http://api.test/api/review/songs/${SONG_ID}/apply`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ checkId: "abc" });
  });

  it("erro da API vira ReviewApiError com status, código e mensagem", async () => {
    const { fetchFn } = fakeFetch({ message: "Lyrics changed since the check", code: "LYRICS_CHANGED" }, 409);

    const error = await api(fetchFn).apply(SONG_ID, "abc").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReviewApiError);
    expect(error).toMatchObject({ status: 409, code: "LYRICS_CHANGED", message: "Lyrics changed since the check" });
  });

  it("erro sem código (ou corpo que não é JSON) fica só com o status", async () => {
    const { fetchFn } = fakeFetch({ message: "Validation error", issues: [] }, 400);
    await expect(api(fetchFn).listSongs()).rejects.toMatchObject({ status: 400, code: null, message: "Validation error" });

    const broken = fakeFetch("<html>gateway</html>", 502);
    await expect(api(broken.fetchFn).listSongs()).rejects.toMatchObject({ status: 502, code: null, message: "HTTP 502" });
  });

  it("API fora do ar → UNREACHABLE; timeout → TIMEOUT", async () => {
    const down = fakeFetch(null, 200, new TypeError("fetch failed"));
    await expect(api(down.fetchFn).listSongs()).rejects.toMatchObject({ status: 0, code: "UNREACHABLE" });

    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const slow = fakeFetch(null, 200, timeout);
    await expect(api(slow.fetchFn).check(SONG_ID, ["a"])).rejects.toMatchObject({ status: 0, code: "TIMEOUT" });
  });
});
