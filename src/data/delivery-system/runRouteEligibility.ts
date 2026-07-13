import { freshnessForSnapshot } from "./providerQuota";
import { readProviderQuotaStore } from "./providerQuotaStore";

export function isRunRouteEligible(stateDir: string, provider: string, model: string | null, now: string): boolean {
  const snapshot = readProviderQuotaStore(stateDir).snapshots.find((candidate) => candidate.provider === provider);
  return snapshot !== undefined && freshnessForSnapshot(snapshot, now) === "fresh" && snapshot.health !== "unavailable" &&
    (model === null || snapshot.models.some((candidate) => candidate.model_id === model && candidate.available && candidate.health !== "unavailable"));
}
