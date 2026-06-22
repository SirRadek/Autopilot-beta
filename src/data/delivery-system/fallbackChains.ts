import type { ReasoningProviderId } from "./modelPolicy";
import type { SubscriptionSessionBudget } from "./subscriptionBudget";

export type FallbackTrigger =
  | "rate_limited"
  | "provider_unavailable"
  | "output_quality_below_threshold"
  | "repeated_failure"
  | "all_tiers_exhausted";

export interface FallbackChainStep {
  readonly trigger: FallbackTrigger;
  readonly fromProvider: ReasoningProviderId;
  readonly fromTierId: string | undefined;
  readonly toProvider: ReasoningProviderId | "owner_decision" | "blocked";
  readonly toTierId: string | undefined;
  readonly condition: string;
  readonly requiresCheckpoint: boolean;
  readonly requiresOwnerApproval: boolean;
}

export const subscriptionFallbackChains: readonly FallbackChainStep[] = [
  {
    trigger: "rate_limited",
    fromProvider: "gemini_cli",
    fromTierId: "gemini_auto",
    toProvider: "gemini_cli",
    toTierId: "gemini_flash",
    condition: "gemini_auto rate limited; Gemini Flash may be tried only when the tier id is locally confirmed later",
    requiresCheckpoint: false,
    requiresOwnerApproval: false
  },
  {
    trigger: "all_tiers_exhausted",
    fromProvider: "gemini_cli",
    fromTierId: undefined,
    toProvider: "blocked",
    toTierId: undefined,
    condition: "All Gemini tiers exhausted; pause only, no provider substitution",
    requiresCheckpoint: false,
    requiresOwnerApproval: false
  },
  {
    trigger: "rate_limited",
    fromProvider: "openai_gpt",
    fromTierId: undefined,
    toProvider: "qwen_local",
    toTierId: undefined,
    condition: "task fits local scope: bounded_coding, micro_worker, test_generation",
    requiresCheckpoint: true,
    requiresOwnerApproval: false
  },
  {
    trigger: "repeated_failure",
    fromProvider: "openai_gpt",
    fromTierId: undefined,
    toProvider: "owner_decision",
    toTierId: undefined,
    condition: "task requires GPT-quality review or a supervisor route decision before further retries",
    requiresCheckpoint: true,
    requiresOwnerApproval: true
  },
  {
    trigger: "provider_unavailable",
    fromProvider: "anthropic_claude_subscription",
    fromTierId: undefined,
    toProvider: "owner_decision",
    toTierId: undefined,
    condition: "Claude unavailable; orchestration is waiting_owner until the owner resumes or changes scope",
    requiresCheckpoint: true,
    requiresOwnerApproval: true
  }
];

export function resolveFallback(
  trigger: FallbackTrigger,
  fromProvider: ReasoningProviderId,
  budget: SubscriptionSessionBudget
): FallbackChainStep | undefined {
  if (fromProvider === "gemini_cli" && allTiersExhausted(budget)) {
    return subscriptionFallbackChains.find(
      (step) => step.fromProvider === "gemini_cli" && step.trigger === "all_tiers_exhausted"
    );
  }

  return subscriptionFallbackChains.find((step) => {
    if (step.trigger !== trigger || step.fromProvider !== fromProvider) {
      return false;
    }

    if (step.fromTierId && step.fromTierId !== budget.activeTierId) {
      return false;
    }

    if (step.toProvider === "gemini_cli" && step.toTierId && budget.exhaustedTierIds.includes(step.toTierId)) {
      return false;
    }

    return true;
  });
}

function allTiersExhausted(budget: SubscriptionSessionBudget): boolean {
  return (
    budget.availableTiers.length > 0 &&
    budget.availableTiers.every((tier) => budget.exhaustedTierIds.includes(tier.tierId))
  );
}
