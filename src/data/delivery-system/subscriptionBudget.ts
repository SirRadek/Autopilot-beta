import type { ReasoningProviderId } from "./modelPolicy";

export type SubscriptionRateLimitState = "available" | "rate_limited" | "exhausted" | "unknown";

export interface ProviderTierSpec {
  readonly provider: ReasoningProviderId;
  readonly tierId: string;
  readonly label: string;
  readonly cliAccessPath: string | undefined;
  readonly verifiedLocally: boolean;
  readonly rateLimitState: SubscriptionRateLimitState;
  /**
   * Relative pool-draw proxy in (0, 1]: how much of a provider's SHARED subscription
   * quota this tier consumes per unit of work. Flagship tier = 1.0; cheaper tiers < 1.0.
   * This is NOT a per-token API-credit figure — it subtracts from a subscription window,
   * not from a metered credit balance (keeps subscription_worker_boundary intact).
   * See docs/decisions/vendor-routing-policy-beta-v2.md.
   *
   * RECONSTRUCTED PLACEHOLDER — re-verify before hardcoding. Every catalog weight below
   * ships verifiedLocally:false for this reason.
   */
  readonly costWeight: number;
  readonly notes: string | undefined;
  readonly lastAttemptedAt: string | undefined;
}

export interface SubscriptionSessionBudget {
  readonly provider: ReasoningProviderId;
  readonly activeTierId: string | undefined;
  readonly activeTierRateLimitState: SubscriptionRateLimitState;
  readonly rateLimitHitAt: string | undefined;
  readonly lastAttemptedAt: string | undefined;
  readonly availableTiers: readonly ProviderTierSpec[];
  readonly exhaustedTierIds: readonly string[];
  readonly sessionTaskCount: number;
  readonly sessionInputTokens: number;
  readonly sessionOutputTokens: number;
  readonly sessionTotalTokens: number;
  readonly sessionCallCount: number;
  readonly lastSuccessfulTaskAt: string | undefined;
  readonly notes: string | undefined;
}

export interface SubscriptionBudgetTokenTelemetry {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly recorded_at: string;
}

export function aggregateCliCallTelemetryIntoBudget(
  budget: SubscriptionSessionBudget,
  telemetry: SubscriptionBudgetTokenTelemetry
): SubscriptionSessionBudget {
  return {
    ...budget,
    sessionInputTokens: safeTokenCount(budget.sessionInputTokens) + safeTokenCount(telemetry.input_tokens),
    sessionOutputTokens: safeTokenCount(budget.sessionOutputTokens) + safeTokenCount(telemetry.output_tokens),
    sessionTotalTokens: safeTokenCount(budget.sessionTotalTokens) + safeTokenCount(telemetry.total_tokens),
    sessionCallCount: safeTokenCount(budget.sessionCallCount) + 1,
    lastAttemptedAt: telemetry.recorded_at
  };
}

function safeTokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// costWeight below is a RECONSTRUCTED PLACEHOLDER (relative pool-draw proxy, not a
// per-token API-credit figure). Each pool's deepest/flagship tier = 1.0; cheaper < 1.0.
// Re-verify before hardcoding — that is why every weight ships verifiedLocally:false.
// See docs/decisions/vendor-routing-policy-beta-v2.md.

export const geminiKnownTiers: readonly ProviderTierSpec[] = [
  {
    provider: "gemini_cli",
    tierId: "gemini_auto",
    label: "Gemini CLI auto tier",
    cliAccessPath: "gemini.cmd -m auto",
    verifiedLocally: true,
    rateLimitState: "available",
    costWeight: 0.5,
    notes: "Local gemini.cmd help confirms -m/--model; existing run logs use -m auto. costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  },
  {
    provider: "gemini_cli",
    tierId: "gemini_flash",
    label: "Gemini Flash tier",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    costWeight: 0.2,
    notes: "Specific CLI model identifier not verified locally; do not hardcode until confirmed. costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  },
  {
    provider: "gemini_cli",
    tierId: "gemini_pro",
    label: "Gemini Pro tier",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    costWeight: 1.0,
    notes: "Specific CLI model identifier not verified locally; do not hardcode until confirmed. Pool flagship (deepest tier). costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  }
];

export const anthropicKnownTiers: readonly ProviderTierSpec[] = [
  {
    provider: "anthropic_claude_subscription",
    tierId: "opus",
    label: "Claude Opus (flagship)",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    costWeight: 1.0,
    notes: "Pool flagship — architecture, high-risk final review, orchestration. costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  },
  {
    provider: "anthropic_claude_subscription",
    tierId: "sonnet_5",
    label: "Claude Sonnet 5 (cheaper)",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    costWeight: 0.4,
    notes: "Cheaper tier — subagents, first-pass review, bounded orchestration. costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  }
];

export const openaiKnownTiers: readonly ProviderTierSpec[] = [
  {
    provider: "openai_gpt",
    tierId: "gpt_5_5",
    label: "GPT-5.5 (flagship)",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    costWeight: 1.0,
    notes: "Pool flagship — high-risk handoff, hardest structural review. costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  },
  {
    provider: "openai_gpt",
    tierId: "gpt_5_4",
    label: "GPT-5.4 (cheaper)",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    costWeight: 0.6,
    notes: "Cheaper tier. costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  },
  {
    provider: "openai_gpt",
    tierId: "gpt_mini",
    label: "GPT mini (cheaper)",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    costWeight: 0.3,
    notes: "Cheaper tier. costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  },
  {
    provider: "openai_gpt",
    tierId: "codex_spark",
    label: "codex-spark (cheaper, spill catch)",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    costWeight: 0.2,
    notes: "Cheapest tier — spill catch for substitutable overflow. costWeight reconstructed placeholder — re-verify before hardcoding.",
    lastAttemptedAt: undefined
  }
];
