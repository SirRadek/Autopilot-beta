import type { ProviderHealth, ProviderModels, ProviderQuota, ProviderQuotaWindow, ReadinessComponent, ReadinessReport, RunReasoningEffort } from "../../types/controlPlane";

export const CANONICAL_PROVIDERS = ["agy_cli", "claude_cli", "codex_cli", "openrouter_api"] as const;

const DIAGNOSIS_MESSAGES: Readonly<Record<string, string>> = {
  probe_not_configured: "Sonda využití není na serveru nakonfigurována — CLI není v konfiguraci control plane.",
  missing_credential: "Chybí přihlašovací údaje (credential) pro tohoto providera.",
  not_observed: "Server zatím nezaznamenal žádné měření tohoto providera.",
  timeout: "Sonda providera vypršela (timeout).",
  malformed_response: "Sonda providera vrátila neplatnou odpověď.",
  provider_unavailable: "Provider je aktuálně nedostupný.",
  provider_error: "Sonda providera selhala (provider_error)."
};

const READINESS_UNAVAILABLE_MESSAGE = "Diagnostika není dostupná: endpoint /ready není na tomto nasazení publikován a server nehlásí žádný snapshot.";

export function providerIds(quotas: readonly ProviderQuota[], models?: ProviderModels, health?: ProviderHealth): string[] {
  return [...new Set([...CANONICAL_PROVIDERS, ...quotas.map((item) => item.provider), ...(health?.providers.map((item) => item.provider) ?? []), ...(models?.models.flatMap((item) => item.providers) ?? [])])].sort();
}

export function selectProviderQuota(quotas: readonly ProviderQuota[], provider: string | undefined): ProviderQuota | undefined {
  return quotas.find((item) => item.provider === provider);
}

export function selectProviderHealth(health: ProviderHealth | undefined, provider: string | undefined) {
  return health?.providers.find((item) => item.provider === provider);
}

export type ProviderDiagnosis = {
  readonly code: string;
  readonly message: string;
  readonly source: "ready" | "quota" | "none";
};

function diagnosisMessage(code: string): string {
  return DIAGNOSIS_MESSAGES[code] ?? `Provider hlásí stav ${code}.`;
}

export function providerDiagnosis(
  provider: string,
  quota: ProviderQuota | undefined,
  health: ProviderHealth | undefined,
  readiness: ReadinessReport | null | undefined
): ProviderDiagnosis | undefined {
  const readinessProviders = readiness?.components.providers as Readonly<Record<string, ReadinessComponent>> | undefined;
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
  const providerModels = (models?.models ?? []).filter((model) => model.providers.includes(provider));
  const rows: ProviderModelRow[] = providerModels.length > 0
    ? providerModels.map((model) => {
      const route = model.provider_routes?.find((candidate) => candidate.provider === provider);
      return {
        model_id: model.model_id,
        available: route?.available ?? model.available,
        health: route?.health === undefined ? model.health.join(", ") : route.health.join(", "),
        source: route?.source ?? model.source ?? "static_fallback",
        reasoning_efforts: route?.reasoning_efforts ?? model.reasoning_efforts,
        updated_at: model.updated_at ?? model.fetched_at ?? quota?.fetched_at ?? null
      };
    })
    : (quota?.models ?? []).map((model) => ({
      model_id: model.model_id,
      available: model.available,
      health: model.health,
      source: "quota_snapshot",
      reasoning_efforts: [],
      updated_at: model.updated_at ?? model.fetched_at ?? quota?.fetched_at ?? null
    }));

  return rows.sort((left, right) => Number(right.available) - Number(left.available) || left.model_id.localeCompare(right.model_id));
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
