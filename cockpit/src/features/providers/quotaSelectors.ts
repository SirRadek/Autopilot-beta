import type { ProviderHealth, ProviderModels, ProviderQuota, ProviderQuotaWindow, ReadinessComponent, ReadinessReport, RunProvider, RunReasoningEffort } from "../../types/controlPlane";
import { KNOWN_PROVIDERS } from "./knownProviders";

export const CANONICAL_PROVIDERS: readonly RunProvider[] = [...KNOWN_PROVIDERS].sort();

const DIAGNOSIS_MESSAGES: Readonly<Record<string, string>> = {
  probe_not_configured: "Sonda využití není na serveru nakonfigurována — CLI není v konfiguraci control plane.",
  missing_credential: "Chybí přihlašovací údaje (credential) pro tohoto poskytovatele.",
  not_observed: "Server zatím nezaznamenal žádné měření tohoto poskytovatele.",
  timeout: "Sonda poskytovatele vypršela (timeout).",
  malformed_response: "Sonda poskytovatele vrátila neplatnou odpověď.",
  provider_unavailable: "Poskytovatel je aktuálně nedostupný.",
  provider_error: "Sonda poskytovatele selhala (provider_error)."
};

const READINESS_UNAVAILABLE_MESSAGE = "Diagnostika není dostupná: endpoint /ready není na tomto nasazení publikován a server nehlásí žádný snímek.";

const HEALTH_LABELS: Readonly<Record<string, string>> = {
  healthy: "V pořádku",
  ok: "V pořádku",
  degraded: "Omezené",
  error: "Chyba",
  unavailable: "Nedostupné"
};

export function providerIds(quotas: readonly ProviderQuota[], models?: ProviderModels, health?: ProviderHealth): string[] {
  const quotaProviders = (Array.isArray(quotas) ? quotas : []).map((item) => item.provider);
  const healthProviders = (Array.isArray(health?.providers) ? health.providers : []).map((item) => item.provider);
  const modelProviders = (Array.isArray(models?.models) ? models.models : []).flatMap((item) => Array.isArray(item.providers) ? item.providers : []);
  return [...new Set([...CANONICAL_PROVIDERS, ...quotaProviders, ...healthProviders, ...modelProviders].filter((provider): provider is string => typeof provider === "string"))].sort();
}

export function selectProviderQuota(quotas: readonly ProviderQuota[], provider: string | undefined): ProviderQuota | undefined {
  return (Array.isArray(quotas) ? quotas : []).find((item) => item.provider === provider);
}

export function selectProviderHealth(health: ProviderHealth | undefined, provider: string | undefined) {
  return (Array.isArray(health?.providers) ? health.providers : []).find((item) => item.provider === provider);
}

export function selectActiveProviderId(
  ids: readonly string[],
  quotas: readonly ProviderQuota[],
  health: ProviderHealth | undefined,
  selectedProvider?: string
): string | undefined {
  if (selectedProvider !== undefined && ids.includes(selectedProvider)) return selectedProvider;

  const quotaByProvider = new Map((Array.isArray(quotas) ? quotas : []).map((quota) => [quota.provider, quota] as const));
  const healthByProvider = new Map((Array.isArray(health?.providers) ? health.providers : []).map((entry) => [entry.provider, entry] as const));
  const providerWithUsableHealth = ids.find((id) => {
    const quota = quotaByProvider.get(id);
    if (quota === undefined) return false;
    const effectiveHealth = healthByProvider.get(id)?.health ?? quota.health;
    return typeof effectiveHealth === "string" && effectiveHealth.trim().length > 0 && effectiveHealth !== "unavailable";
  });

  return providerWithUsableHealth ?? ids.find((id) => quotaByProvider.has(id)) ?? ids[0];
}

export type ProviderDiagnosis = {
  readonly code: string;
  readonly message: string;
  readonly source: "ready" | "quota" | "none";
};

function diagnosisMessage(code: string): string {
  return DIAGNOSIS_MESSAGES[code] ?? `Poskytovatel hlásí stav ${code}.`;
}

export function providerDiagnosis(
  provider: string,
  quota: ProviderQuota | undefined,
  health: ProviderHealth | undefined,
  readiness: ReadinessReport | null | undefined
): ProviderDiagnosis | undefined {
  const readinessProviders = readiness?.components?.providers as Readonly<Record<string, ReadinessComponent>> | undefined;
  const readinessEntry = readinessProviders?.[provider];
  if (readinessEntry !== undefined && readinessEntry.status !== "ready") {
    const code = readinessEntry.error_code ?? readinessEntry.status;
    return { code, message: diagnosisMessage(code), source: "ready" };
  }

  const snapshotCode = quota?.error_code ?? selectProviderHealth(health, provider)?.error_code;
  if (snapshotCode !== null && snapshotCode !== undefined) {
    return { code: snapshotCode, message: diagnosisMessage(snapshotCode), source: "quota" };
  }

  if (quota === undefined) {
    return {
      code: "not_observed",
      message: readiness === null ? READINESS_UNAVAILABLE_MESSAGE : DIAGNOSIS_MESSAGES.not_observed,
      source: "none"
    };
  }

  return undefined;
}

export type ProviderModelRow = {
  readonly model_id: string;
  readonly available: boolean;
  readonly health: string;
  readonly source: "live_snapshot" | "static_fallback" | "mixed" | "quota_snapshot";
  readonly reasoning_efforts: readonly RunReasoningEffort[];
  readonly updated_at: string | null;
};

export function selectProviderModelRows(provider: string, quota: ProviderQuota | undefined, models: ProviderModels | undefined): readonly ProviderModelRow[] {
  const providerModels = (Array.isArray(models?.models) ? models.models : [])
    .filter((model) => typeof model.model_id === "string" && Array.isArray(model.providers) && model.providers.includes(provider));
  const rows: ProviderModelRow[] = providerModels.length > 0
    ? providerModels.map((model) => {
      const route = (Array.isArray(model.provider_routes) ? model.provider_routes : []).find((candidate) => candidate.provider === provider);
      return {
        model_id: model.model_id,
        available: route?.available ?? model.available ?? false,
        health: (Array.isArray(route?.health) ? route.health : Array.isArray(model.health) ? model.health : []).join(", "),
        source: route?.source ?? model.source ?? "static_fallback",
        reasoning_efforts: Array.isArray(route?.reasoning_efforts) ? route.reasoning_efforts : Array.isArray(model.reasoning_efforts) ? model.reasoning_efforts : [],
        updated_at: model.updated_at ?? model.fetched_at ?? quota?.fetched_at ?? null
      };
    })
    : (Array.isArray(quota?.models) ? quota.models : []).filter((model) => typeof model.model_id === "string").map((model) => ({
      model_id: model.model_id,
      available: model.available === true,
      health: typeof model.health === "string" ? model.health : "",
      source: "quota_snapshot",
      reasoning_efforts: [],
      updated_at: model.updated_at ?? model.fetched_at ?? quota?.fetched_at ?? null
    }));

  return rows.sort((left, right) => Number(right.available) - Number(left.available) || left.model_id.localeCompare(right.model_id));
}

export function formatQuotaValue(value: number | null | undefined): string { return typeof value === "number" ? value.toLocaleString() : "Nedostupné"; }

export function formatQuotaWindow(window: ProviderQuotaWindow | null | undefined): string {
  if (typeof window?.limit !== "number" || typeof window?.used !== "number") return "Nedostupné";
  const percent = window.limit > 0 ? Math.round((window.used / window.limit) * 100) : 0;
  return `${formatQuotaValue(window.used)} / ${formatQuotaValue(window.limit)} (${percent}%)`;
}

export function freshnessLabel(freshness: string | undefined): string {
  if (freshness === "fresh") return "Čerstvé";
  if (freshness === "stale") return "Zastaralé";
  return "Nedostupné";
}

export function healthLabel(health: string | null | undefined, fallback = "Nedostupné"): string {
  if (typeof health !== "string" || health.trim().length === 0) return fallback;
  return health.split(",").map((value) => {
    const trimmed = value.trim();
    return HEALTH_LABELS[trimmed.toLowerCase()] ?? trimmed;
  }).join(", ");
}
