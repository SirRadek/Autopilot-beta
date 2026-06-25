import type { CliWorkerFailureSignal } from "./cliWorker";
import type { ReasoningProviderId } from "./modelPolicy";
import type { SubscriptionSessionBudget } from "./subscriptionBudget";

export type TierCircuitStatus = "closed" | "open";

export interface TierFailureSignalRecord {
  readonly provider: ReasoningProviderId;
  readonly tierId: string | undefined;
  readonly failureSignal: CliWorkerFailureSignal;
  readonly recordedAt: string;
}

export interface TierCircuitBreakerThresholds {
  readonly failureThreshold: number;
  readonly windowMs: number;
  readonly cooldownMs: number;
  readonly failureSignals?: readonly CliWorkerFailureSignal[];
}

export interface TierCircuitState {
  readonly provider: ReasoningProviderId;
  readonly tierId: string | undefined;
  readonly status: TierCircuitStatus;
  readonly failureCount: number;
  readonly cooldownUntil: string | undefined;
}

export const CIRCUIT_BREAKER_FAILURE_SIGNALS = [
  "empty_output",
  "invalid_json",
  "auth_error",
  "timeout"
] as const satisfies readonly CliWorkerFailureSignal[];

export const DEFAULT_TIER_CIRCUIT_BREAKER_THRESHOLDS = {
  failureThreshold: 3,
  windowMs: 10 * 60 * 1000,
  cooldownMs: 15 * 60 * 1000,
  failureSignals: CIRCUIT_BREAKER_FAILURE_SIGNALS
} as const satisfies TierCircuitBreakerThresholds;

export function computeTierCircuitState(
  recentSignals: readonly TierFailureSignalRecord[],
  thresholds: TierCircuitBreakerThresholds,
  now: string | Date
): readonly TierCircuitState[] {
  validateThresholds(thresholds);

  const nowMs = parseTimeMs(now, "now");
  const windowStartMs = nowMs - thresholds.windowMs;
  const countedSignals = new Set(thresholds.failureSignals ?? CIRCUIT_BREAKER_FAILURE_SIGNALS);
  const grouped = new Map<string, TierFailureSignalRecord[]>();

  for (const signal of recentSignals) {
    if (!countedSignals.has(signal.failureSignal)) {
      continue;
    }

    const recordedMs = parseOptionalTimeMs(signal.recordedAt);
    if (recordedMs === undefined || recordedMs > nowMs || recordedMs < windowStartMs) {
      continue;
    }

    const key = circuitKey(signal.provider, signal.tierId);
    const bucket = grouped.get(key) ?? [];
    bucket.push(signal);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries())
    .map(([key, signals]) => {
      const { provider, tierId } = parseCircuitKey(key);
      const lastFailureMs = Math.max(...signals.map((signal) => parseTimeMs(signal.recordedAt, "recordedAt")));
      const cooldownUntilMs = lastFailureMs + thresholds.cooldownMs;
      const isOpen = signals.length >= thresholds.failureThreshold && nowMs < cooldownUntilMs;

      return {
        provider,
        tierId,
        status: isOpen ? "open" : "closed",
        failureCount: signals.length,
        cooldownUntil: isOpen ? new Date(cooldownUntilMs).toISOString() : undefined
      } satisfies TierCircuitState;
    })
    .sort(compareCircuitStates);
}

export function isTierCircuitOpen(
  circuitStates: readonly TierCircuitState[],
  provider: ReasoningProviderId,
  tierId: string | undefined
): boolean {
  return circuitStates.some((state) => {
    if (state.status !== "open" || state.provider !== provider) {
      return false;
    }

    return state.tierId === undefined || tierId === undefined || state.tierId === tierId;
  });
}

export function isSelfFallbackRoute(input: {
  readonly fromProvider: ReasoningProviderId;
  readonly fromTierId: string | undefined;
  readonly toProvider: ReasoningProviderId | "owner_decision" | "blocked";
  readonly toTierId: string | undefined;
}): boolean {
  if (input.toProvider === "owner_decision" || input.toProvider === "blocked") {
    return false;
  }

  if (input.fromProvider !== input.toProvider) {
    return false;
  }

  return input.fromTierId === undefined || input.toTierId === undefined || input.fromTierId === input.toTierId;
}

export function isActiveTierExplicitlyUnverified(budget: SubscriptionSessionBudget): boolean {
  if (budget.activeTierId === undefined) {
    return false;
  }

  return budget.availableTiers.some(
    (tier) => tier.tierId === budget.activeTierId && tier.verifiedLocally === false
  );
}

export function isFallbackTierLocallyConfirmed(input: {
  readonly toProvider: ReasoningProviderId | "owner_decision" | "blocked";
  readonly toTierId: string | undefined;
  readonly budgets: readonly SubscriptionSessionBudget[];
}): boolean {
  if (input.toProvider === "owner_decision" || input.toProvider === "blocked" || input.toTierId === undefined) {
    return true;
  }

  const targetBudget = input.budgets.find((budget) => budget.provider === input.toProvider);
  if (!targetBudget) {
    return false;
  }

  return targetBudget.availableTiers.some(
    (tier) => tier.tierId === input.toTierId && tier.verifiedLocally === true
  );
}

export function isVerifiedTierExhaustedOrOpen(
  budget: SubscriptionSessionBudget,
  tierId: string,
  circuitStates: readonly TierCircuitState[]
): boolean {
  const tier = budget.availableTiers.find((candidate) => candidate.tierId === tierId);

  return (
    budget.exhaustedTierIds.includes(tierId) ||
    tier?.rateLimitState === "exhausted" ||
    isTierCircuitOpen(circuitStates, budget.provider, tierId)
  );
}

function validateThresholds(thresholds: TierCircuitBreakerThresholds): void {
  if (!Number.isInteger(thresholds.failureThreshold) || thresholds.failureThreshold <= 0) {
    throw new Error("routing_circuit_invalid_threshold: failureThreshold must be a positive integer");
  }

  if (!Number.isFinite(thresholds.windowMs) || thresholds.windowMs <= 0) {
    throw new Error("routing_circuit_invalid_threshold: windowMs must be a positive number");
  }

  if (!Number.isFinite(thresholds.cooldownMs) || thresholds.cooldownMs <= 0) {
    throw new Error("routing_circuit_invalid_threshold: cooldownMs must be a positive number");
  }
}

function parseOptionalTimeMs(value: string): number | undefined {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTimeMs(value: string | Date, label: string): number {
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    throw new Error(`routing_circuit_invalid_time: ${label} is not a valid timestamp`);
  }

  return parsed;
}

function circuitKey(provider: ReasoningProviderId, tierId: string | undefined): string {
  return `${provider}\u0000${tierId ?? ""}`;
}

function parseCircuitKey(key: string): { readonly provider: ReasoningProviderId; readonly tierId: string | undefined } {
  const [provider, tierId] = key.split("\u0000");
  if (!isReasoningProviderId(provider)) {
    throw new Error(`routing_circuit_invalid_provider: ${provider ?? ""}`);
  }

  return {
    provider,
    tierId: tierId === "" ? undefined : tierId
  };
}

function compareCircuitStates(a: TierCircuitState, b: TierCircuitState): number {
  const providerCompare = a.provider.localeCompare(b.provider);
  if (providerCompare !== 0) {
    return providerCompare;
  }

  return (a.tierId ?? "").localeCompare(b.tierId ?? "");
}

function isReasoningProviderId(value: string | undefined): value is ReasoningProviderId {
  return (
    value === "deterministic_tools" ||
    value === "qwen_local" ||
    value === "openai_gpt" ||
    value === "anthropic_claude_subscription" ||
    value === "gemini_cli" ||
    value === "deepseek_api_or_self_hosted" ||
    value === "deepseek_web_chat_manual"
  );
}
