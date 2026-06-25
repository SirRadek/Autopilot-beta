import type { ReasoningProviderId } from "./modelPolicy";

export type SubscriptionRateLimitState = "available" | "rate_limited" | "exhausted" | "unknown";

export interface ProviderTierSpec {
  readonly provider: ReasoningProviderId;
  readonly tierId: string;
  readonly label: string;
  readonly cliAccessPath: string | undefined;
  readonly verifiedLocally: boolean;
  readonly rateLimitState: SubscriptionRateLimitState;
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

export const geminiKnownTiers: readonly ProviderTierSpec[] = [
  {
    provider: "gemini_cli",
    tierId: "gemini_auto",
    label: "Gemini CLI auto tier",
    cliAccessPath: "gemini.cmd -m auto",
    verifiedLocally: true,
    rateLimitState: "available",
    notes: "Local gemini.cmd help confirms -m/--model; existing run logs use -m auto.",
    lastAttemptedAt: undefined
  },
  {
    provider: "gemini_cli",
    tierId: "gemini_flash",
    label: "Gemini Flash tier",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    notes: "Specific CLI model identifier not verified locally; do not hardcode until confirmed.",
    lastAttemptedAt: undefined
  },
  {
    provider: "gemini_cli",
    tierId: "gemini_pro",
    label: "Gemini Pro tier",
    cliAccessPath: undefined,
    verifiedLocally: false,
    rateLimitState: "unknown",
    notes: "Specific CLI model identifier not verified locally; do not hardcode until confirmed.",
    lastAttemptedAt: undefined
  }
];
