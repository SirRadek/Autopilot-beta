import { SUPPORTED_REASONING_EFFORTS, type RunReasoningEffort } from "./executionProfile";
import type { ProviderSnapshot } from "./providerQuota";
import { AGY_VERIFIED_MODELS } from "./routingModes";

export const STATIC_PROVIDER_MODEL_CATALOG = {
  claude_cli: {
    models: [
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001"
    ],
    reasoning_efforts: SUPPORTED_REASONING_EFFORTS.claude_cli
  },
  codex_cli: {
    // Owner-approved dispatch routes. These are the picker-visible rows
    // (`visibility: "list"`) of the installed CLI's models_cache.json for 0.144.5,
    // so each one is a route the CLI itself offers. Reasoning support is per model
    // and comes from the cache — only gpt-5.6-sol and gpt-5.6-terra advertise `ultra`.
    models: [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      // Daybreak Blue tier: frontier models with safeguards adjusted for authorised
      // defensive security work (vulnerability discovery, secure code review, malware
      // analysis, incident response). The account's access is gated by OpenAI identity
      // verification and legal attestation, so it is a route this owner genuinely holds.
      "gpt-daybreak-blue-latest",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark"
    ],
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
