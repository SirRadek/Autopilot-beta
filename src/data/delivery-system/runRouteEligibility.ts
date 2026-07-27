import { SUPPORTED_REASONING_EFFORTS, type RunProfile, type RunReasoningEffort } from "./executionProfile";
import { isKnownProviderModel } from "./providerModelCatalog";
import { freshnessForSnapshot } from "./providerQuota";
import { readProviderQuotaStore } from "./providerQuotaStore";

export function isRunRouteEligible(stateDir: string, provider: string, model: string | null, now: string): boolean {
  const snapshot = readProviderQuotaStore(stateDir).snapshots.find((candidate) => candidate.provider === provider);
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
  if (!Object.hasOwn(SUPPORTED_REASONING_EFFORTS, provider)) return false;
  const supported = SUPPORTED_REASONING_EFFORTS[provider as keyof typeof SUPPORTED_REASONING_EFFORTS] as readonly RunReasoningEffort[];
  if (reasoning !== null && !supported.includes(reasoning)) return false;
  if (profile === "prod") return isRunRouteEligible(stateDir, provider, model, now);
  if (isRunRouteEligible(stateDir, provider, model, now)) return true;
  return model !== null && isKnownProviderModel(readProviderQuotaStore(stateDir).snapshots, provider as keyof typeof SUPPORTED_REASONING_EFFORTS, model);
}
