import { describe, expect, it } from "vitest";

import { estimateBrainstormTokenEnvelope } from "../../src/data/delivery-system/brainstormBudget";

const routes = [
  { provider: "codex_cli", model: "gpt-5", reasoning_effort: "high", estimated_tokens: 12_000 },
  { provider: "claude_cli", model: "sonnet", reasoning_effort: "high", estimated_tokens: 12_000 },
  { provider: "agy_cli", model: "gemini-pro", reasoning_effort: "high", estimated_tokens: 12_000 },
] as const;

describe("brainstorm token envelope", () => {
  it("computes the canonical fanout, consolidation, and optional arbitration token bounds", () => {
    expect(estimateBrainstormTokenEnvelope(routes, 10_000, 8_000)).toEqual({
      fanout_tokens: 36_000,
      consolidation_tokens: 10_000,
      optional_arbitration_tokens: 8_000,
      minimum_tokens: 46_000,
      maximum_tokens: 54_000,
    });
  });

  it("rejects non-integer, negative, and overflowing token counts", () => {
    expect(() => estimateBrainstormTokenEnvelope([{ ...routes[0], estimated_tokens: 1.5 }], 1, 0)).toThrow("invalid_brainstorm_token_budget");
    expect(() => estimateBrainstormTokenEnvelope(routes, -1, 0)).toThrow("invalid_brainstorm_token_budget");
    expect(() => estimateBrainstormTokenEnvelope([{ ...routes[0], estimated_tokens: Number.MAX_SAFE_INTEGER }], 1, 0)).toThrow("invalid_brainstorm_token_budget");
  });
});
