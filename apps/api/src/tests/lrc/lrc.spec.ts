import { describe, expect, it } from "vitest";
import { parseLrc } from "../../utils/lrc.js";

describe("parseLrc", () => {
  it("lê [mm:ss.xx] (centésimos) e [mm:ss.xxx] (milésimos)", () => {
    expect(parseLrc("[00:12.34]primeira\n[01:02.345]segunda")).toEqual([
      { startMs: 12_340, text: "primeira" },
      { startMs: 62_345, text: "segunda" },
    ]);
  });

  it("aceita [mm:ss] sem fração e um dígito de fração", () => {
    expect(parseLrc("[00:05]a\n[00:07.5]b")).toEqual([
      { startMs: 5_000, text: "a" },
      { startMs: 7_500, text: "b" },
    ]);
  });

  it("várias tags na mesma linha viram uma linha por tag", () => {
    expect(parseLrc("[00:10.00][00:30.00]refrão")).toEqual([
      { startMs: 10_000, text: "refrão" },
      { startMs: 30_000, text: "refrão" },
    ]);
  });

  it("ignora tags de metadado e linhas sem tag de tempo", () => {
    const lrc = "[ar:Artista]\n[ti:Título]\n[offset:+200]\nlinha solta\n[00:01.00]oi";

    expect(parseLrc(lrc)).toEqual([{ startMs: 1_000, text: "oi" }]);
  });

  it("preserva linhas com texto vazio (trechos instrumentais)", () => {
    expect(parseLrc("[00:01.00]oi\n[00:05.00]\n[00:09.00]tchau")).toEqual([
      { startMs: 1_000, text: "oi" },
      { startMs: 5_000, text: "" },
      { startMs: 9_000, text: "tchau" },
    ]);
  });

  it("ordena por startMs", () => {
    expect(parseLrc("[00:30.00]c\n[00:10.00]a\n[00:20.00]b").map((line) => line.text)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("aceita quebras de linha \\r\\n e espaços em volta", () => {
    expect(parseLrc("[00:01.00]  oi  \r\n[00:02.00]tchau\r\n")).toEqual([
      { startMs: 1_000, text: "oi" },
      { startMs: 2_000, text: "tchau" },
    ]);
  });

  it("texto sem nenhuma tag devolve lista vazia", () => {
    expect(parseLrc("só letra\nsem tempo")).toEqual([]);
  });
});
