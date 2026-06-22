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
  readonly lastSuccessfulTaskAt: string | undefined;
  readonly notes: string | undefined;
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
