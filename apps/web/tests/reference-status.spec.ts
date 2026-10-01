import { describe, expect, it } from "vitest";
import { PROCESSING_STALE_MS, isProcessingStale } from "../lib/reference-status";

const SINCE = "2026-09-26T16:23:00.000Z";
const since = Date.parse(SINCE);

describe("isProcessingStale", () => {
  it("dentro do limite não trava", () => {
    expect(isProcessingStale(SINCE, since + 3 * 60_000)).toBe(false);
    expect(isProcessingStale(SINCE, since + PROCESSING_STALE_MS)).toBe(false);
  });

  it("depois do limite (o mesmo da API) trava", () => {
    expect(isProcessingStale(SINCE, since + PROCESSING_STALE_MS + 1)).toBe(true);
    expect(isProcessingStale(SINCE, since + 60 * 60_000)).toBe(true);
  });

  it("sem data ou com data ilegível não dá para dizer", () => {
    expect(isProcessingStale(null, since + 60 * 60_000)).toBe(false);
    expect(isProcessingStale("ontem", since + 60 * 60_000)).toBe(false);
  });

  it("relógio da tela atrasado em relação ao servidor não trava", () => {
    expect(isProcessingStale(SINCE, since - 60_000)).toBe(false);
  });
});
