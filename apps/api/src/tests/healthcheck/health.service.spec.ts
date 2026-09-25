import { describe, it, expect } from "vitest";
import { healthService } from "../../services/health.service.js";

describe("Health Service", () => {
  it("deve retornar status ok e um timestamp", () => {
    const result = healthService.check();

    expect(result.status).toBe("ok");
    expect(result.timestamp).toBeInstanceOf(Date);
  });
});
