import type { ProviderHealth, ProviderModel, ProviderModels, ProviderQuota, ProviderQuotaWindow } from "../../types/controlPlane";

export function providerIds(quotas: readonly ProviderQuota[], models?: ProviderModels, health?: ProviderHealth): string[] {
  return [...new Set([...quotas.map((item) => item.provider), ...(health?.providers.map((item) => item.provider) ?? []), ...(models?.models.flatMap((item) => item.providers) ?? [])])].sort();
}

export function selectProviderQuota(quotas: readonly ProviderQuota[], provider: string | undefined): ProviderQuota | undefined {
  return quotas.find((item) => item.provider === provider);
}

export function selectProviderHealth(health: ProviderHealth | undefined, provider: string | undefined) {
  return health?.providers.find((item) => item.provider === provider);
}

export function selectProviderModels(quota: ProviderQuota | undefined, models: ProviderModels | undefined, provider?: string): readonly ProviderModel[] {
  if (quota?.models.length) return quota.models;
  return (models?.models ?? []).filter((model) => model.providers.includes(quota?.provider ?? provider ?? "")).map((model) => ({ model_id: model.model_id, available: model.available, health: model.health.join(", "), source: model.providers.join(", "), fetched_at: model.fetched_at, updated_at: model.updated_at }));
}

export function formatQuotaValue(value: number | null): string { return value === null ? "Unavailable" : value.toLocaleString(); }

export function formatQuotaWindow(window: ProviderQuotaWindow): string {
  if (window.limit === null || window.used === null) return "Unavailable";
  const percent = window.limit > 0 ? Math.round((window.used / window.limit) * 100) : 0;
  return `${formatQuotaValue(window.used)} / ${formatQuotaValue(window.limit)} (${percent}%)`;
}

export function freshnessLabel(freshness: string | undefined): string {
  if (freshness === "fresh") return "Fresh";
  if (freshness === "stale") return "Stale";
  return "Unavailable";
}
