import { SUPPORTED_REASONING_EFFORTS, type RunReasoningEffort } from "./executionProfile";
import type { ProviderSnapshot } from "./providerQuota";
import { AGY_VERIFIED_MODELS } from "./routingModes";

export const STATIC_PROVIDER_MODEL_CATALOG = {
  claude_cli: {
    models: ["claude-opus-4-8"],
    reasoning_efforts: SUPPORTED_REASONING_EFFORTS.claude_cli
  },
  codex_cli: {
    models: ["gpt-5.6-sol"],
    reasoning_efforts: SUPPORTED_REASONING_EFFORTS.codex_cli
  },
  agy_cli: {
    models: [
      AGY_VERIFIED_MODELS.agy_fast_default,
      AGY_VERIFIED_MODELS.agy_fast_quality,
      AGY_VERIFIED_MODELS.agy_deep,
      AGY_VERIFIED_MODELS.agy_gpt_oss_120b,
      AGY_VERIFIED_MODELS.agy_claude_sonnet_4_6
    ],
    reasoning_efforts: SUPPORTED_REASONING_EFFORTS.agy_cli
  }
} as const satisfies Partial<Record<keyof typeof SUPPORTED_REASONING_EFFORTS, {
  readonly models: readonly string[];
  readonly reasoning_efforts: readonly RunReasoningEffort[];
}>>;

export function isKnownProviderModel(
  snapshots: readonly ProviderSnapshot[],
  provider: keyof typeof SUPPORTED_REASONING_EFFORTS,
  model: string
): boolean {
  const staticModels = Object.hasOwn(STATIC_PROVIDER_MODEL_CATALOG, provider)
    ? STATIC_PROVIDER_MODEL_CATALOG[provider as keyof typeof STATIC_PROVIDER_MODEL_CATALOG].models
    : [];
  if ((staticModels as readonly string[]).includes(model)) return true;
  return snapshots.some((snapshot) => snapshot.provider === provider &&
    snapshot.models.some((candidate) => candidate.model_id === model && candidate.available));
}
