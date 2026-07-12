import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  assertTokenBudget,
  remainingTokenBudget,
  TokenGateway,
  TokenGatewayError
} from "../../src/data/delivery-system/tokenGateway";

describe("token gateway", () => {
  it("allows within budget and reports remaining capacity", () => {
    const budget = { max_tokens: 100, used_tokens: 25 };
    expect(() => assertTokenBudget({ estimatedTokens: 75, budget })).not.toThrow();
    expect(remainingTokenBudget(budget)).toBe(75);
  });

  it("rejects over-budget work before dispatch", () => {
    expect(() => assertTokenBudget({ estimatedTokens: 76, budget: { max_tokens: 100, used_tokens: 25 } })).toThrow("token_budget_exceeded");
  });

  it("reserves, settles actual usage, and releases unused capacity", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "token-gateway-"));
    const gateway = new TokenGateway({ stateDir, limits: {
      inputCapTokens: 100,
      outputCapTokens: 100,
      providerBudgetTokens: 200,
      modelBudgetTokens: 200,
      sessionBudgetTokens: 200
    } });
    const reservation = gateway.reserve({ provider: "codex_cli", model: "codex", sessionId: "s1", inputTokens: 20, outputTokens: 60, handoffId: "h1" });
    expect(gateway.snapshot().activeReservations).toBe(1);
    expect(gateway.settle(reservation, { inputTokens: 15, outputTokens: 10 })).toEqual({ inputTokens: 15, outputTokens: 10, released: false });
    expect(gateway.snapshot().used["session:s1"]).toBe(25);

    const second = gateway.reserve({ provider: "codex_cli", model: "codex", sessionId: "s1", inputTokens: 10, outputTokens: 10 });
    gateway.release(second);
    expect(gateway.snapshot().used["session:s1"]).toBe(25);
  });

  it("refuses exhaustion, caps, and route changes without leaking prompt data", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "token-gateway-"));
    const gateway = new TokenGateway({ stateDir, limits: {
      inputCapTokens: 10,
      outputCapTokens: 10,
      providerBudgetTokens: 20,
      modelBudgetTokens: 20,
      sessionBudgetTokens: 20
    } });
    expect(() => gateway.reserve({ provider: "codex_cli", model: null, sessionId: "s", inputTokens: 11, outputTokens: 1 })).toThrow("token_input_cap_exceeded");
    const reservation = gateway.reserve({ provider: "codex_cli", model: null, sessionId: "s", inputTokens: 5, outputTokens: 5 });
    expect(() => gateway.reserve({ provider: "codex_cli", model: null, sessionId: "s", inputTokens: 6, outputTokens: 5 })).toThrow("token_budget_exhausted");
    expect(() => gateway.settle({ ...reservation, provider: "openrouter_api" }, { inputTokens: 1, outputTokens: 1 })).toThrow(TokenGatewayError);
    const telemetry = readFileSync(join(stateDir, "token-gateway-telemetry.jsonl"), "utf8");
    expect(telemetry).not.toContain("password");
    expect(telemetry.length).toBeLessThan(64 * 1024);
  });
});
