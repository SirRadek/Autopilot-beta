import { SUPPORTED_REASONING_EFFORTS, type RunProfile, type RunReasoningEffort } from "./executionProfile";
import { isKnownProviderModel, STATIC_PROVIDER_MODEL_CATALOG } from "./providerModelCatalog";
import { freshnessForSnapshot } from "./providerQuota";
import { readProviderQuotaStore, type ProviderQuotaStoreDocument } from "./providerQuotaStore";

export function isRunRouteEligible(
  stateDir: string,
  provider: string,
  model: string | null,
  now: string,
  reasoning?: RunReasoningEffort | null
): boolean {
  const snapshots = readProviderQuotaStore(stateDir).snapshots;
  if (reasoning !== undefined && !supportsReasoning(snapshots, provider, model, reasoning)) return false;
  const snapshot = snapshots.find((candidate) => candidate.provider === provider);
  return snapshot !== undefined && freshnessForSnapshot(snapshot, now) === "fresh" && snapshot.health !== "unavailable" &&
    (model === null || snapshot.models.some((candidate) => candidate.model_id === model && candidate.available && candidate.health !== "unavailable"));
}

export function isRunRouteEligibleForProfile(
  stateDir: string,
  provider: string,
  model: string | null,
  reasoning: RunReasoningEffort | null,
  profile: RunProfile,
  now: string
): boolean {
  const snapshots = readProviderQuotaStore(stateDir).snapshots;
  if (!supportsReasoning(snapshots, provider, model, reasoning)) return false;
  if (profile === "prod") return isRunRouteEligible(stateDir, provider, model, now, reasoning);
  if (isRunRouteEligible(stateDir, provider, model, now, reasoning)) return true;
  return model !== null && isKnownProviderModel(snapshots, provider as keyof typeof SUPPORTED_REASONING_EFFORTS, model);
}

function supportsReasoning(
  snapshots: ProviderQuotaStoreDocument["snapshots"],
  provider: string,
  model: string | null,
  reasoning: RunReasoningEffort | null
): boolean {
  if (!Object.hasOwn(SUPPORTED_REASONING_EFFORTS, provider)) return false;
  const supported = SUPPORTED_REASONING_EFFORTS[provider as keyof typeof SUPPORTED_REASONING_EFFORTS] as readonly RunReasoningEffort[];
  if (reasoning === null) return true;
  if (!supported.includes(reasoning)) return false;
  if (provider !== "codex_cli") return true;
  const selectedModel = model === null
    ? undefined
    : snapshots.find((snapshot) => snapshot.provider === provider)
      ?.models.find((candidate) => candidate.model_id === model);
  if (selectedModel?.reasoning_efforts !== undefined) return selectedModel.reasoning_efforts.includes(reasoning);
  if (selectedModel !== undefined || model === null) return false;
  return (STATIC_PROVIDER_MODEL_CATALOG.codex_cli.models as readonly string[]).includes(model);
}
