import { describe, expect, it } from "vitest";
import { DEFAULT_MONITOR_VOLUME, MONITOR_MAX, MONITOR_MIN, monitorGain, normalizeMonitorVolume } from "../lib/monitor-volume";

describe("normalizeMonitorVolume", () => {
  it("arredonda ao passo de 5", () => {
    expect(normalizeMonitorVolume(42)).toBe(40);
    expect(normalizeMonitorVolume(43)).toBe(45);
  });

  it("limita a 0–100 e trata NaN como o padrão", () => {
    expect(normalizeMonitorVolume(250)).toBe(MONITOR_MAX);
    expect(normalizeMonitorVolume(-10)).toBe(MONITOR_MIN);
    expect(normalizeMonitorVolume(Number.NaN)).toBe(DEFAULT_MONITOR_VOLUME);
  });
});

describe("monitorGain", () => {
  it("converte o volume em ganho de 0 a 1", () => {
    expect(monitorGain(0)).toBe(0);
    expect(monitorGain(70)).toBeCloseTo(0.7);
    expect(monitorGain(100)).toBe(1);
  });
});
