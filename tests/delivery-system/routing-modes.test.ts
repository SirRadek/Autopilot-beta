import { describe, expect, it } from "vitest";

import {
  AGY_VERIFIED_MODELS,
  EXPENSIVE_LANES,
  LANE_COST_TIERS,
  LaneNotAllowedInModeError,
  assertLaneAllowedInMode,
  getRoutingMode,
  isLaneAllowedInMode,
  isWithinStepBudget,
  resolveRoutingLane,
  routingModes,
  type RoutingLaneId,
  type RoutingModeId
} from "../../src/data/delivery-system/routingModes";

describe("routing mode catalog", () => {
  it("declares all routing modes exactly once with non-empty lane lists", () => {
    const expectedModeIds = ["idea", "spec", "build", "review"] as const satisfies readonly RoutingModeId[];
    const ids = routingModes.map((mode) => mode.id);

    expect(ids).toHaveLength(expectedModeIds.length);
    expect([...new Set(ids)].sort()).toEqual([...expectedModeIds].sort());

    for (const mode of routingModes) {
      expect(mode.allowedLanes.length).toBeGreaterThan(0);
    }

    const idea = getRoutingMode("idea");
    expect(idea.slice).toBe("shipped");
    expect(idea.expensiveLanesAllowed).toBe(false);
  });

  it("declares bounded step budgets per routing mode", () => {
    const expectedStepBudgets = {
      idea: 2,
      spec: 3,
      build: 3,
      review: 2
    } as const satisfies Record<RoutingModeId, number>;

    for (const mode of routingModes) {
      expect(Number.isInteger(mode.step_budget)).toBe(true);
      expect(mode.step_budget).toBeGreaterThanOrEqual(2);
      expect(mode.step_budget).toBeLessThanOrEqual(3);
      expect(mode.step_budget).toBe(expectedStepBudgets[mode.id]);
    }
  });

  it("checks step budget boundaries for correction rounds", () => {
    for (const mode of routingModes) {
      const budget = mode.step_budget;

      expect(isWithinStepBudget(mode.id, 1)).toBe(true);
      expect(isWithinStepBudget(mode.id, budget)).toBe(true);
      expect(isWithinStepBudget(mode.id, budget + 1)).toBe(false);
      expect(isWithinStepBudget(mode.id, 0)).toBe(false);
      expect(isWithinStepBudget(mode.id, 1.5)).toBe(false);
    }
  });

  it("allows Idea Mode cheap advisory lanes", () => {
    const allowedIdeaLanes = [
      "agy_fast",
      "agy_deep",
      "agy_gpt_oss_120b",
      "agy_claude_sonnet_4_6",
      "openrouter_nemotron_planning"
    ] as const satisfies readonly RoutingLaneId[];

    for (const lane of allowedIdeaLanes) {
      expect(isLaneAllowedInMode("idea", lane)).toBe(true);
      expect(() => assertLaneAllowedInMode("idea", lane)).not.toThrow();
    }
  });

  it("hard-refuses expensive lanes in Idea Mode", () => {
    expect(isLaneAllowedInMode("idea", "claude_supervisor")).toBe(false);
    expect(isLaneAllowedInMode("idea", "codex_cli")).toBe(false);

    expect(() => assertLaneAllowedInMode("idea", "codex_cli")).toThrow(LaneNotAllowedInModeError);

    try {
      assertLaneAllowedInMode("idea", "codex_cli");
      throw new Error("expected assertLaneAllowedInMode to reject codex_cli in idea mode");
    } catch (err) {
      expect(err).toBeInstanceOf(LaneNotAllowedInModeError);
      if (err instanceof LaneNotAllowedInModeError) {
        expect(err.reason).toBe("lane_not_allowed_in_mode");
        expect(err.modeId).toBe("idea");
        expect(err.lane).toBe("codex_cli");
      }
    }
  });

  it("keeps modes with expensive lanes disabled disjoint from expensive lanes", () => {
    const expensiveLanes = new Set<RoutingLaneId>(EXPENSIVE_LANES);

    for (const mode of routingModes.filter((candidate) => candidate.expensiveLanesAllowed === false)) {
      expect(mode.allowedLanes.filter((lane) => expensiveLanes.has(lane))).toEqual([]);
    }
  });

  it("throws when a routing mode id is unknown at runtime", () => {
    expect(() => getRoutingMode("unknown" as unknown as RoutingModeId)).toThrow(/routing_mode_not_found/);
  });

  it("keeps lane cost tiers complete and aligned with expensive lane policy", () => {
    const expectedLaneIds = [
      "agy_fast",
      "agy_deep",
      "agy_gpt_oss_120b",
      "agy_claude_sonnet_4_6",
      "openrouter_nemotron_planning",
      "openrouter_qwen3_code_draft",
      "qwen_local",
      "deterministic_tools",
      "claude_supervisor",
      "codex_cli"
    ] as const satisfies readonly RoutingLaneId[];
    const tieredLaneIds = Object.keys(LANE_COST_TIERS) as RoutingLaneId[];

    expect(tieredLaneIds).toHaveLength(expectedLaneIds.length);
    expect([...new Set(tieredLaneIds)].sort()).toEqual([...expectedLaneIds].sort());

    const expensiveTierLanes = tieredLaneIds.filter((lane) => LANE_COST_TIERS[lane] === "expensive");
    expect(expensiveTierLanes.sort()).toEqual([...EXPENSIVE_LANES].sort());

    for (const mode of routingModes.filter((candidate) => candidate.expensiveLanesAllowed === false)) {
      expect(mode.allowedLanes.every((lane) => LANE_COST_TIERS[lane] === "free" || LANE_COST_TIERS[lane] === "mid")).toBe(
        true
      );
    }
  });

  it("maps verified agy model slugs to routing lanes", () => {
    expect(resolveRoutingLane({ vendor: "agy_cli", model: "gpt-oss-120b" })).toBe("agy_gpt_oss_120b");
    expect(resolveRoutingLane({ vendor: "agy_cli", model: "claude-4.6-sonnet" })).toBe(
      "agy_claude_sonnet_4_6"
    );
    expect(resolveRoutingLane({ vendor: "agy_cli", model: "gemini-3.5-flash-medium" })).toBe("agy_fast");
    expect(resolveRoutingLane({ vendor: "agy_cli", model: "gemini-3.1-pro-high" })).toBe("agy_deep");
  });

  it("allows the verified MID agy lanes in review mode", () => {
    expect(isLaneAllowedInMode("review", "agy_gpt_oss_120b")).toBe(true);
    expect(isLaneAllowedInMode("review", "agy_claude_sonnet_4_6")).toBe(true);
  });

  it("characterizes verified agy model pins", () => {
    expect(AGY_VERIFIED_MODELS).toEqual({
      agy_fast_default: "gemini-3.5-flash-medium",
      agy_fast_quality: "gemini-3.5-flash-high",
      agy_deep: "gemini-3.1-pro-high",
      agy_gpt_oss_120b: "gpt-oss-120b",
      agy_claude_sonnet_4_6: "claude-4.6-sonnet"
    });
  });
});
