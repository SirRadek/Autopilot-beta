import { describe, expect, it } from "vitest";

import {
  evaluateEfficiencyBudget,
  resolveEfficiencyBudget,
} from "../../src/data/delivery-system/efficiencyPolicy";

const ordinary = {
  work_unit_id: "wu-1",
  class: "bounded_implementation",
  risk: "ordinary",
} as const;

describe("efficiency policy", () => {
  it("uses the conservative ordinary budget", () => {
    expect(resolveEfficiencyBudget(ordinary)).toEqual({
      max_direct_subagents: 2,
      max_depth: 1,
      max_total_attempts: 2,
      max_reviews: 1,
      max_rereviews: 1,
      context_soft_limit_tokens: 150_000,
    });
  });

  it("reports every exceeded dimension", () => {
    expect(
      evaluateEfficiencyBudget(ordinary, {
        direct_subagents: 3,
        depth: 2,
        total_attempts: 3,
        reviews: 2,
        rereviews: 2,
        context_tokens: 160_000,
        attempt_two_delta: null,
      }).map((item) => item.code),
    ).toEqual([
      "subagent_budget_exceeded",
      "recursive_fanout_forbidden",
      "attempt_budget_exceeded",
      "attempt_delta_missing",
      "review_budget_exceeded",
      "rereview_budget_exceeded",
      "context_checkpoint_required",
    ]);
  });

  it("requires a bounded high-risk override instead of silently allowing expansion", () => {
    const highRisk = {
      work_unit_id: "wu-2",
      class: "high_risk",
      risk: "high",
    } as const;

    expect(
      evaluateEfficiencyBudget(highRisk, {
        direct_subagents: 3,
        depth: 1,
        total_attempts: 2,
        reviews: 1,
        rereviews: 1,
        context_tokens: 100_000,
        attempt_two_delta: "new invariant test",
      })[0]?.code,
    ).toBe("override_required");
  });
});
