import { describe, expect, it } from "vitest";

import {
  assertRoleConstraint,
  reasoningProviderPolicies,
  reasoningTaskLanePolicies,
  selectReasoningModelRoute
} from "../../src/data/delivery-system/modelPolicy";
import { subscriptionFallbackChains, resolveFallback } from "../../src/data/delivery-system/fallbackChains";
import {
  computeTierCircuitState,
  type TierCircuitBreakerThresholds,
  type TierFailureSignalRecord
} from "../../src/data/delivery-system/routingGuards";
import type {
  ProviderTierSpec,
  SubscriptionSessionBudget
} from "../../src/data/delivery-system/subscriptionBudget";

const providerId = "openrouter_free";

describe("OpenRouter free Stage 0 policy registration", () => {
  it("registers a policy-only provider entry with the ADR guardrails", () => {
    const policy = requireProviderPolicy(providerId);
    const deepseekPolicy = requireProviderPolicy("deepseek_api_or_self_hosted");

    expect(Object.keys(policy)).toEqual(Object.keys(deepseekPolicy));
    expect(policy).toMatchObject({
      id: providerId,
      provider: "openrouter",
      accessMode: "api_or_self_hosted",
      advisoryTrustTier: "bounded_draft",
      advisoryWeight: 45
    });
    expect(policy.contextScope).toContain("qwen/qwen3-coder:free");
    expect(policy.contextScope).toContain("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(policy.bestFor).toEqual([
      "qwen/qwen3-coder:free code drafts",
      "qwen/qwen3-coder:free test drafts",
      "qwen/qwen3-coder:free refactor drafts",
      "nvidia/nemotron-3-ultra-550b-a55b:free planning drafts",
      "nvidia/nemotron-3-ultra-550b-a55b:free brainstorming drafts",
      "nvidia/nemotron-3-ultra-550b-a55b:free long-context research drafts"
    ]);
    expect(policy.avoidFor).toEqual([
      "final delivery approval",
      "security-critical review",
      "sensitive/private context",
      "architecture decisions",
      "source-of-truth claims",
      "OpenRouter auto-router",
      "paid spill"
    ]);
    expect(policy.requiredChecks).toEqual([
      "provider_availability_verified",
      "free_tier_or_no_cost_confirmed",
      "redacted_context_only",
      "redaction_before_send",
      "explicit_model_id_allowlist",
      "model_output_scored_before_acceptance",
      "eval_recorded_for_output",
      "local_verification_required"
    ]);
    expect(policy.stopConditions).toEqual([
      "provider_availability_unverified",
      "private_data_not_redacted",
      "broad_private_context_sent_to_lower_trust_model",
      "sensitive_private_context_sent_to_free_route",
      "paid_model_or_credit_required_without_owner_decision",
      "openrouter_paid_spill_detected",
      "openrouter_auto_router_requested",
      "openrouter_missing_env_key_not_reported_as_missing",
      "model_output_used_as_source_of_truth"
    ]);
    expect(policy.sourceIds).toEqual(["openrouter-free-lane-adr"]);
  });

  it("rejects promotion beyond advisory draft authority", () => {
    expect(() => assertRoleConstraint({ assignedProvider: providerId, authorityRole: "advisory" })).not.toThrow();
    expect(() =>
      assertRoleConstraint({ assignedProvider: providerId, authorityRole: "source_of_truth" })
    ).toThrow(/model_output_used_as_source_of_truth/);
    expect(() =>
      assertRoleConstraint({ assignedProvider: providerId, authorityRole: "authoritative" })
    ).toThrow(/model_output_used_as_source_of_truth/);
  });

  it("does not activate OpenRouter in any lane or fallback path", () => {
    for (const lane of reasoningTaskLanePolicies) {
      expect(lane.preferredProviders, lane.id).not.toContain(providerId);
    }

    expect(reasoningTaskLanePolicies.find((lane) => lane.id === "sensitive_private_context")?.preferredProviders).toEqual([
      "deterministic_tools",
      "qwen_local"
    ]);

    for (const step of subscriptionFallbackChains) {
      expect(step.fromProvider).not.toBe(providerId);
      expect(step.toProvider).not.toBe(providerId);
    }

    expect(selectReasoningModelRoute({ task: "OpenRouter qwen free code draft" }).providerPolicies).not.toContain(
      providerId
    );
    expect(selectReasoningModelRoute({ task: "nemotron long-context planning draft" }).providerPolicies).not.toContain(
      providerId
    );
  });

  it("accepts the provider id in circuit-breaker and budget structures without adding fallback behavior", () => {
    const thresholds: TierCircuitBreakerThresholds = {
      failureThreshold: 2,
      windowMs: 60 * 60 * 1000,
      cooldownMs: 10 * 60 * 1000
    };
    const recentFailureSignals: readonly TierFailureSignalRecord[] = [
      signal("empty_output", "2026-07-04T10:00:00.000Z"),
      signal("timeout", "2026-07-04T10:01:00.000Z")
    ];

    expect(computeTierCircuitState(recentFailureSignals, thresholds, "2026-07-04T10:02:00.000Z")).toEqual([
      {
        provider: providerId,
        tierId: "qwen/qwen3-coder:free",
        status: "open",
        failureCount: 2,
        cooldownUntil: "2026-07-04T10:11:00.000Z"
      }
    ]);

    expect(resolveFallback("rate_limited", providerId, openRouterBudget, { budgets: [openRouterBudget] })).toBeUndefined();
  });
});

function requireProviderPolicy(id: typeof reasoningProviderPolicies[number]["id"]) {
  const policy = reasoningProviderPolicies.find((candidate) => candidate.id === id);
  expect(policy).toBeDefined();
  return policy!;
}

function signal(
  failureSignal: TierFailureSignalRecord["failureSignal"],
  recordedAt: string
): TierFailureSignalRecord {
  return {
    provider: providerId,
    tierId: "qwen/qwen3-coder:free",
    failureSignal,
    recordedAt
  };
}

const openRouterTier: ProviderTierSpec = {
  provider: providerId,
  tierId: "qwen/qwen3-coder:free",
  label: "OpenRouter qwen3 coder free",
  cliAccessPath: undefined,
  verifiedLocally: false,
  costWeight: 0,
  rateLimitState: "unknown",
  notes: "Stage 0 registry-only provider entry; no network client or route activation.",
  lastAttemptedAt: undefined
};

const openRouterBudget: SubscriptionSessionBudget = {
  provider: providerId,
  activeTierId: undefined,
  activeTierRateLimitState: "unknown",
  rateLimitHitAt: undefined,
  lastAttemptedAt: undefined,
  availableTiers: [openRouterTier],
  exhaustedTierIds: [],
  sessionTaskCount: 0,
  sessionInputTokens: 0,
  sessionOutputTokens: 0,
  sessionTotalTokens: 0,
  sessionCallCount: 0,
  lastSuccessfulTaskAt: undefined,
  notes: "Neutral Stage 0 budget shape only."
};
