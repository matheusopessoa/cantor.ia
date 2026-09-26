import { describe, expect, it } from "vitest";
import { outputChoices } from "../lib/music-output";

const device = (kind: MediaDeviceKind, deviceId: string, label = "") => ({ kind, deviceId, label });

describe("outputChoices", () => {
  it("fica só com as saídas de áudio e tira os apelidos da saída padrão", () => {
    const choices = outputChoices([
      device("audiooutput", "default", "Padrão - Fone"),
      device("audiooutput", "communications", "Comunicações - Fone"),
      device("audioinput", "mic", "Microfone"),
      device("audiooutput", "tv", "TV (HDMI)"),
      device("audiooutput", "fone", "Fone"),
    ]);
    expect(choices).toEqual([
      { deviceId: "tv", label: "TV (HDMI)", named: true },
      { deviceId: "fone", label: "Fone", named: true },
    ]);
  });

  it("ignora id vazio (sem permissão) e repetidos", () => {
    expect(outputChoices([device("audiooutput", ""), device("audiooutput", "a", "A"), device("audiooutput", "a", "A")])).toEqual([
      { deviceId: "a", label: "A", named: true },
    ]);
  });

  it("numera os aparelhos sem nome", () => {
    expect(outputChoices([device("audiooutput", "a"), device("audiooutput", "b", "  ")])).toEqual([
      { deviceId: "a", label: "Saída 1", named: false },
      { deviceId: "b", label: "Saída 2", named: false },
    ]);
  });
});
