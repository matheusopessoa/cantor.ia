import { describe, it, expect } from "vitest";
import { assertTestDatabase } from "./database.js";

describe("assertTestDatabase", () => {
  it("aceita banco terminado em _test", () => {
    expect(() =>
      assertTestDatabase("postgresql://test:test@localhost:5433/feedback_test"),
    ).not.toThrow();
  });

  it("recusa o banco de desenvolvimento", () => {
    expect(() =>
      assertTestDatabase("postgresql://admin:senha@localhost:5432/feedback_db"),
    ).toThrow(/Recusando truncar/);
  });

  it("recusa banco de produção", () => {
    expect(() =>
      assertTestDatabase("postgresql://user:pass@rds.aws.com:5432/feedback_prod_db"),
    ).toThrow(/Recusando truncar/);
  });

  it("recusa URL ausente em vez de assumir um padrão", () => {
    expect(() => assertTestDatabase(undefined)).toThrow(/não sabe qual banco limpar/);
  });
});
