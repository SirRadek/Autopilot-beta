export interface BrainstormTokenEnvelope {
  readonly fanout_tokens: number;
  readonly consolidation_tokens: number;
  readonly optional_arbitration_tokens: number;
  readonly minimum_tokens: number;
  readonly maximum_tokens: number;
}

interface EstimatedBrainstormRoute {
  readonly estimated_tokens: number;
}

export function estimateBrainstormTokenEnvelope(
  routes: readonly EstimatedBrainstormRoute[],
  consolidationTokens: number,
  optionalArbitrationTokens: number,
): BrainstormTokenEnvelope {
  if (!Array.isArray(routes) || routes.length === 0 ||
    !positiveTokenCount(consolidationTokens) || !nonNegativeTokenCount(optionalArbitrationTokens) ||
    !routes.every((route) => isRecord(route) && positiveTokenCount(route.estimated_tokens))) {
    throw new Error("invalid_brainstorm_token_budget");
  }

  const fanoutTokens = routes.reduce((sum, route) => safeTokenSum(sum, route.estimated_tokens), 0);
  const minimumTokens = safeTokenSum(fanoutTokens, consolidationTokens);
  const maximumTokens = safeTokenSum(minimumTokens, optionalArbitrationTokens);
  return {
    fanout_tokens: fanoutTokens,
    consolidation_tokens: consolidationTokens,
    optional_arbitration_tokens: optionalArbitrationTokens,
    minimum_tokens: minimumTokens,
    maximum_tokens: maximumTokens,
  };
}

function positiveTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeTokenSum(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error("invalid_brainstorm_token_budget");
  return total;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
