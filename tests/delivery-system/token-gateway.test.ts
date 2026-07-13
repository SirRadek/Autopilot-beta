import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  assertTokenBudget,
  remainingTokenBudget,
  TokenGateway,
  TokenGatewayError,
  validateTokenGatewayState
} from "../../src/data/delivery-system/tokenGateway";

const STATE_FILE = "token-gateway-state.json";
const NOW = "2026-07-13T12:00:00.000Z";

function writeGatewayState(stateDir: string, state: unknown): string {
  const serialized = JSON.stringify(state);
  writeFileSync(join(stateDir, STATE_FILE), serialized);
  return serialized;
}

function activeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const reservationId = "tgr-00000000-0000-4000-8000-000000000000";
  return {
    used: {
      "provider:codex_cli": 5,
      "model:codex_cli:gpt-5": 5,
      "session:session-1": 5
    },
    reservations: {
      [reservationId]: {
        provider: "codex_cli",
        model: "gpt-5",
        sessionId: "session-1",
        inputTokens: 2,
        outputTokens: 3,
        handoffId: "handoff-1",
        reservationId,
        reservedAt: NOW,
        totalTokens: 5
      }
    },
    terminal: {},
    ...overrides
  };
}

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

  it("atomically rejects settlement beyond the immutable reservation total", () => {
    const gateway = new TokenGateway({ stateDir: mkdtempSync(join(tmpdir(), "token-gateway-")) });
    const reservation = gateway.reserve({ provider: "codex_cli", model: "gpt-5", sessionId: "s", inputTokens: 5, outputTokens: 5, handoffId: "h" });
    expect(() => gateway.settle(reservation, { inputTokens: 6, outputTokens: 5 })).toThrow("token_settlement_exceeds_reservation");
    expect(gateway.findActiveReservation("h")).toEqual(reservation);
  });

  it("does not allow settlement growth near provider, model, or session caps", () => {
    const gateway = new TokenGateway({ stateDir: mkdtempSync(join(tmpdir(), "token-gateway-")), limits: { providerBudgetTokens: 10, modelBudgetTokens: 10, sessionBudgetTokens: 10 } });
    const reservation = gateway.reserve({ provider: "codex_cli", model: "gpt-5", sessionId: "s", inputTokens: 4, outputTokens: 6 });
    expect(() => gateway.settle(reservation, { inputTokens: 5, outputTokens: 6 })).toThrow("token_settlement_exceeds_reservation");
    expect(() => gateway.reserve({ provider: "codex_cli", model: "gpt-5", sessionId: "s", inputTokens: 1, outputTokens: 0 })).toThrow("token_budget_exhausted");
  });

  it("bounds active zero-token reservations and prunes the terminal ledger", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "token-gateway-bounds-"));
    const gateway = new TokenGateway({ stateDir, limits: { inputCapTokens: 1, outputCapTokens: 1, providerBudgetTokens: 1, modelBudgetTokens: 1, sessionBudgetTokens: 1 } });
    const reservations = Array.from({ length: 512 }, (_, index) => gateway.reserve({ provider: "codex_cli", model: null, sessionId: `s-${index}`, inputTokens: 0, outputTokens: 0, handoffId: `h-${index}` }));
    expect(() => gateway.reserve({ provider: "codex_cli", model: null, sessionId: "overflow", inputTokens: 0, outputTokens: 0, handoffId: "overflow" })).toThrow("token_reservation_limit");
    for (const reservation of reservations) gateway.release(reservation);
    for (let index = 0; index < 1_100; index += 1) {
      const reservation = gateway.reserve({ provider: "codex_cli", model: null, sessionId: `terminal-${index}`, inputTokens: 0, outputTokens: 0, handoffId: `terminal-${index}` });
      gateway.release(reservation);
    }
    const state = JSON.parse(readFileSync(join(stateDir, "token-gateway-state.json"), "utf8"));
    expect(Object.keys(state.terminal)).toHaveLength(1024);
    expect(readFileSync(join(stateDir, "token-gateway-state.json")).byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
  }, 15_000);

  it("rejects loaded state whose entry counts exceed caps", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "token-gateway-loaded-bounds-"));
    const used = Object.fromEntries(Array.from({ length: 1_537 }, (_, index) => [`session:${index}`, 1]));
    writeFileSync(join(stateDir, "token-gateway-state.json"), JSON.stringify({ used, reservations: {}, terminal: {} }));
    expect(() => new TokenGateway({ stateDir })).toThrow("invalid_token_gateway_state");
  });

  it("rejects semantically malformed persisted state with a fixed error and no mutation", () => {
    const reservationId = "tgr-00000000-0000-4000-8000-000000000000";
    const reservation = (overrides: Record<string, unknown> = {}) => ({
      provider: "codex_cli",
      model: "gpt-5",
      sessionId: "session-1",
      inputTokens: 2,
      outputTokens: 3,
      handoffId: "handoff-1",
      reservationId,
      reservedAt: NOW,
      totalTokens: 5,
      ...overrides
    });
    const terminal = (overrides: Record<string, unknown> = {}) => ({
      event: "settled",
      settlement: { inputTokens: 2, outputTokens: 3, released: false },
      completedAt: NOW,
      ...overrides
    });
    const cases: readonly [string, unknown][] = [
      ["unknown top-level field", { ...activeState(), secret: "must-not-leak" }],
      ["fractional usage", activeState({ used: { "provider:codex_cli": 0.5, "model:codex_cli:gpt-5": 0.5, "session:session-1": 0.5 } })],
      ["zero usage", activeState({ used: { "provider:codex_cli": 0, "model:codex_cli:gpt-5": 0, "session:session-1": 0 } })],
      ["unsafe usage", activeState({ used: { "provider:codex_cli": Number.MAX_SAFE_INTEGER + 1, "model:codex_cli:gpt-5": Number.MAX_SAFE_INTEGER + 1, "session:session-1": Number.MAX_SAFE_INTEGER + 1 } })],
      ["unknown usage namespace", activeState({ used: { "other:codex_cli": 5, "model:codex_cli:gpt-5": 5, "session:session-1": 5 } })],
      ["empty usage route", activeState({ used: { "provider:": 5, "model:codex_cli:gpt-5": 5, "session:session-1": 5 } })],
      ["oversized usage key", activeState({ used: { [`provider:${"p".repeat(129)}`]: 5, "model:codex_cli:gpt-5": 5, "session:session-1": 5 } })],
      ["incoherent aggregate totals", activeState({ used: { "provider:codex_cli": 6, "model:codex_cli:gpt-5": 5, "session:session-1": 5 } })],
      ["active reservation not covered", activeState({ used: { "provider:codex_cli": 4, "provider:other": 1, "model:codex_cli:gpt-5": 5, "session:session-1": 5 } })],
      ["unknown reservation field", activeState({ reservations: { [reservationId]: reservation({ secret: "must-not-leak" }) } })],
      ["empty provider", activeState({ reservations: { [reservationId]: reservation({ provider: "" }) } })],
      ["oversized model", activeState({ reservations: { [reservationId]: reservation({ model: "m".repeat(129) }) } })],
      ["unnormalized session", activeState({ reservations: { [reservationId]: reservation({ sessionId: "line\nbreak" }) } })],
      ["empty handoff", activeState({ reservations: { [reservationId]: reservation({ handoffId: "" }) } })],
      ["invalid reservation timestamp", activeState({ reservations: { [reservationId]: reservation({ reservedAt: "yesterday" }) } })],
      ["fractional reservation count", activeState({ reservations: { [reservationId]: reservation({ inputTokens: 2.5, totalTokens: 5.5 }) } })],
      ["unsafe reservation count", activeState({ reservations: { [reservationId]: reservation({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, totalTokens: Number.MAX_SAFE_INTEGER + 1 }) } })],
      ["duplicate handoff", activeState({ reservations: {
        [reservationId]: reservation(),
        "tgr-00000000-0000-4000-8000-000000000001": reservation({ reservationId: "tgr-00000000-0000-4000-8000-000000000001" })
      } })],
      ["active and terminal id collision", activeState({ terminal: { [reservationId]: terminal() } })],
      ["unknown terminal field", activeState({ reservations: {}, terminal: { [reservationId]: terminal({ secret: "must-not-leak" }) } })],
      ["unknown settlement field", activeState({ reservations: {}, terminal: { [reservationId]: terminal({ settlement: { inputTokens: 2, outputTokens: 3, released: false, secret: "must-not-leak" } }) } })],
      ["invalid terminal status", activeState({ reservations: {}, terminal: { [reservationId]: terminal({ event: "pending" }) } })],
      ["invalid terminal timestamp", activeState({ reservations: {}, terminal: { [reservationId]: terminal({ completedAt: "yesterday" }) } })],
      ["fractional settlement count", activeState({ reservations: {}, terminal: { [reservationId]: terminal({ settlement: { inputTokens: 2.5, outputTokens: 3, released: false } }) } })],
      ["incoherent released terminal", activeState({ reservations: {}, terminal: { [reservationId]: terminal({ event: "released" }) } })]
    ];

    for (const [name, state] of cases) {
      const stateDir = mkdtempSync(join(tmpdir(), "token-gateway-invalid-"));
      const before = writeGatewayState(stateDir, state);
      let message = "";
      try {
        validateTokenGatewayState(stateDir);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect.soft(message, name).toBe("invalid_token_gateway_state");
      expect.soft(readFileSync(join(stateDir, STATE_FILE), "utf8"), name).toBe(before);
    }
  });

  it("accepts valid boundary, legacy, active, and settled states without rewriting them", () => {
    const reservationId = "tgr-00000000-0000-4000-8000-000000000000";
    const maxField = "x".repeat(128);
    const states = [
      { used: {}, reservations: {}, terminal: {} },
      activeState(),
      {
        used: {},
        reservations: {
          [reservationId]: {
            provider: "codex_cli",
            model: null,
            sessionId: null,
            inputTokens: 0,
            outputTokens: 0,
            reservationId,
            reservedAt: NOW,
            totalTokens: 0
          }
        },
        terminal: {}
      },
      {
        used: {
          [`provider:${maxField}`]: 1,
          [`model:${maxField}:${maxField}`]: 1,
          [`session:${maxField}`]: 1
        },
        reservations: {
          [reservationId]: {
            provider: maxField,
            model: maxField,
            sessionId: maxField,
            inputTokens: 0,
            outputTokens: 1,
            handoffId: maxField,
            reservationId,
            reservedAt: NOW,
            totalTokens: 1
          }
        },
        terminal: {}
      },
      {
        used: { "provider:codex_cli": 5, "model:codex_cli:gpt-5": 5, "session:session-1": 5 },
        reservations: {},
        terminal: {
          [reservationId]: {
            event: "settled",
            settlement: { inputTokens: 2, outputTokens: 3 }
          }
        }
      },
      {
        used: {},
        reservations: {},
        terminal: {
          [reservationId]: {
            event: "released",
            settlement: { inputTokens: 0, outputTokens: 0, released: true }
          }
        }
      }
    ];

    for (const state of states) {
      const stateDir = mkdtempSync(join(tmpdir(), "token-gateway-valid-"));
      const before = writeGatewayState(stateDir, state);
      expect(() => validateTokenGatewayState(stateDir)).not.toThrow();
      expect(readFileSync(join(stateDir, STATE_FILE), "utf8")).toBe(before);
    }
  });
});
