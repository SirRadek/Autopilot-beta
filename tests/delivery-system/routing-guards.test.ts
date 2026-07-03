import { describe, expect, it } from "vitest";

import {
  resolveFallback,
  type FallbackChainStep
} from "../../src/data/delivery-system/fallbackChains";
import {
  assertRoleConstraint,
  buildSupervisorRoutingDecision,
  resolveCliVendorForLayer,
  selectReasoningModelRoute
} from "../../src/data/delivery-system/modelPolicy";
import {
  computeTierCircuitState,
  isSelfFallbackRoute,
  type TierCircuitBreakerThresholds,
  type TierFailureSignalRecord
} from "../../src/data/delivery-system/routingGuards";
import {
  geminiKnownTiers,
  type ProviderTierSpec,
  type SubscriptionSessionBudget
} from "../../src/data/delivery-system/subscriptionBudget";
import { contextWidthSpecs } from "../../src/data/delivery-system/tokenEfficiency";

const circuitThresholds: TierCircuitBreakerThresholds = {
  failureThreshold: 3,
  windowMs: 60 * 60 * 1000,
  cooldownMs: 10 * 60 * 1000
};

const openAiTier: ProviderTierSpec = {
  provider: "openai_gpt",
  tierId: "codex_subscription",
  label: "Codex subscription",
  cliAccessPath: "codex",
  verifiedLocally: true,
  rateLimitState: "available",
  costWeight: 1.0,
  notes: undefined,
  lastAttemptedAt: undefined
};

const openAiBudget: SubscriptionSessionBudget = {
  provider: "openai_gpt",
  activeTierId: "codex_subscription",
  activeTierRateLimitState: "available",
  rateLimitHitAt: undefined,
  lastAttemptedAt: undefined,
  availableTiers: [openAiTier],
  exhaustedTierIds: [],
  sessionTaskCount: 0,
  sessionInputTokens: 0,
  sessionOutputTokens: 0,
  sessionTotalTokens: 0,
  sessionCallCount: 0,
  lastSuccessfulTaskAt: undefined,
  notes: undefined
};

describe("routing invariants", () => {
  it("pauses instead of returning a self fallback candidate", () => {
    const selfFallback: FallbackChainStep = {
      trigger: "repeated_failure",
      fromProvider: "openai_gpt",
      fromTierId: "codex_subscription",
      toProvider: "openai_gpt",
      toTierId: "codex_subscription",
      condition: "bad self retry",
      requiresCheckpoint: false,
      requiresOwnerApproval: false
    };

    expect(isSelfFallbackRoute({
      fromProvider: "openai_gpt",
      fromTierId: "codex_subscription",
      toProvider: "openai_gpt",
      toTierId: "codex_subscription"
    })).toBe(true);

    const fallback = resolveFallback("repeated_failure", "openai_gpt", openAiBudget, {
      fallbackChain: [selfFallback],
      budgets: [openAiBudget]
    });

    expect(fallback?.toProvider).toBe("blocked");
    expect(fallback?.toTierId).toBeUndefined();
    expect(fallback?.condition).toContain("No valid fallback candidate remains");
  });

  it("filters an unverified Gemini tier candidate", () => {
    const geminiBudget: SubscriptionSessionBudget = {
      provider: "gemini_cli",
      activeTierId: "gemini_auto",
      activeTierRateLimitState: "rate_limited",
      rateLimitHitAt: "2026-06-25T12:00:00.000Z",
      lastAttemptedAt: "2026-06-25T12:00:00.000Z",
      availableTiers: geminiKnownTiers,
      exhaustedTierIds: [],
      sessionTaskCount: 1,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      sessionTotalTokens: 0,
      sessionCallCount: 1,
      lastSuccessfulTaskAt: undefined,
      notes: undefined
    };

    const fallback = resolveFallback("rate_limited", "gemini_cli", geminiBudget, {
      budgets: [geminiBudget]
    });

    expect(fallback?.toProvider).toBe("blocked");
    expect(fallback?.toTierId).toBeUndefined();
  });

  it("opens a circuit from deterministic failure signals and routes to the next valid provider", () => {
    const now = "2026-06-25T12:00:00.000Z";
    const recentFailureSignals: readonly TierFailureSignalRecord[] = [
      signal("empty_output", "2026-06-25T11:57:00.000Z"),
      signal("invalid_json", "2026-06-25T11:58:00.000Z"),
      signal("timeout", "2026-06-25T11:59:00.000Z")
    ];

    expect(computeTierCircuitState(recentFailureSignals, circuitThresholds, now)).toEqual([
      {
        provider: "openai_gpt",
        tierId: "codex_subscription",
        status: "open",
        failureCount: 3,
        cooldownUntil: "2026-06-25T12:09:00.000Z"
      }
    ]);

    const decision = buildSupervisorRoutingDecision({
      taskId: "hp-circuit-open",
      taskDescription: "bounded implementation",
      layer: "bounded_coding",
      budgets: [openAiBudget],
      evalRecords: [],
      recentFailureSignals,
      circuitBreakerThresholds: circuitThresholds,
      now
    });

    expect(decision.assignedProvider).toBe("qwen_local");
    expect(decision.fallbackProvider).toBe("qwen_local");
    expect(decision.decisionReasoning).toContain("Preferred provider openai_gpt was skipped by routing guards.");
  });

  it("closes the circuit after cooldown elapses", () => {
    const recentFailureSignals: readonly TierFailureSignalRecord[] = [
      signal("empty_output", "2026-06-25T11:00:00.000Z"),
      signal("invalid_json", "2026-06-25T11:01:00.000Z"),
      signal("timeout", "2026-06-25T11:02:00.000Z")
    ];

    expect(computeTierCircuitState(recentFailureSignals, circuitThresholds, "2026-06-25T11:40:00.000Z")).toEqual([
      {
        provider: "openai_gpt",
        tierId: "codex_subscription",
        status: "closed",
        failureCount: 3,
        cooldownUntil: undefined
      }
    ]);

    const decision = buildSupervisorRoutingDecision({
      taskId: "hp-circuit-closed",
      taskDescription: "bounded implementation",
      layer: "bounded_coding",
      budgets: [openAiBudget],
      evalRecords: [],
      recentFailureSignals,
      circuitBreakerThresholds: circuitThresholds,
      now: "2026-06-25T11:40:00.000Z"
    });

    expect(decision.assignedProvider).toBe("openai_gpt");
    expect(decision.fallbackProvider).toBe("openai_gpt");
  });

  it("rejects promotion of advisory model output to source of truth", () => {
    expect(() =>
      assertRoleConstraint({ assignedProvider: "gemini_cli", authorityRole: "source_of_truth" })
    ).toThrow(/model_output_used_as_source_of_truth/);

    expect(() =>
      assertRoleConstraint({ assignedProvider: "deterministic_tools", authorityRole: "source_of_truth" })
    ).not.toThrow();
  });

  it("prefers the riskier lane when a task multi-matches (S0 lane priority)", () => {
    // "security audit": "audit" hits deterministic_verification, but "security"/"audit"
    // also hit architecture_security_review. The riskier review lane must win.
    const securityAudit = buildSupervisorRoutingDecision({
      taskId: "s0-security-audit",
      taskDescription: "security audit of the auth boundary",
      layer: "reviewer",
      budgets: [openAiBudget],
      evalRecords: []
    });
    expect(securityAudit.taskLane).toBe("architecture_security_review");

    // The advisory route surfaces the same priority in taskLanes[0].
    const route = selectReasoningModelRoute({ task: "security audit of the auth boundary" });
    expect(route.route).toBe("external_advisory_review");
    expect(route.taskLanes[0]).toBe("architecture_security_review");
    // The deterministic lane still co-matches (it is not dropped, just deprioritized).
    expect(route.taskLanes).toContain("deterministic_verification");
  });

  it("leaves a single-match lane unchanged (S0 does not alter single-match)", () => {
    // "typecheck" is a signal ONLY on deterministic_verification.
    const typecheckDecision = buildSupervisorRoutingDecision({
      taskId: "s0-typecheck",
      taskDescription: "typecheck the delivery-system module",
      layer: "reviewer",
      budgets: [openAiBudget],
      evalRecords: []
    });
    expect(typecheckDecision.taskLane).toBe("deterministic_verification");
  });

  it("routes a multi-signal description to the riskier lane (S0)", () => {
    // "architecture audit": "audit" hits deterministic_verification; "architecture"/"audit"
    // hit architecture_security_review. Riskier lane leads.
    const decision = buildSupervisorRoutingDecision({
      taskId: "s0-multi-signal",
      taskDescription: "architecture audit and build check",
      layer: "reviewer",
      budgets: [openAiBudget],
      evalRecords: []
    });
    expect(decision.taskLane).toBe("architecture_security_review");
  });

  it("keeps the local Codex happy path decision unchanged", () => {
    expect(resolveCliVendorForLayer("bounded_coding")).toBe("codex_cli");
    expect(selectReasoningModelRoute({ task: "simple boilerplate dto" }).route).toBe("local_worker_default");

    expect(buildSupervisorRoutingDecision({
      taskId: "hp-happy",
      taskDescription: "bounded implementation",
      layer: "bounded_coding",
      budgets: [openAiBudget],
      evalRecords: []
    })).toEqual({
      taskId: "hp-happy",
      layer: "bounded_coding",
      tokenEfficiencyProfile: "standard_compact",
      contextWidthSpec: contextWidthSpecs.small,
      taskLane: "bounded_coding_worker",
      assignedProvider: "openai_gpt",
      assignedTierId: "codex_subscription",
      subscriptionBudgetState: "available",
      fallbackProvider: "openai_gpt",
      learningSignal: {
        taskType: "bounded_coding",
        provider: "openai",
        recentFailureCount: 0,
        lastFailureLabels: [],
        recommendedDelta: "no_change",
        confidenceSource: "no_data"
      },
      decisionReasoning:
        "Layer bounded_coding maps to openai_gpt; context width small; task lane bounded_coding_worker."
    });
  });
});

function signal(
  failureSignal: TierFailureSignalRecord["failureSignal"],
  recordedAt: string
): TierFailureSignalRecord {
  return {
    provider: "openai_gpt",
    tierId: "codex_subscription",
    failureSignal,
    recordedAt
  };
}
