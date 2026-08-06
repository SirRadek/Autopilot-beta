import React from "react";
import type { ProbeProviderId, ProbeRefreshResult, ProviderHealth, ProviderModels, ProviderQuota, ReadinessReport } from "../../types/controlPlane";
import {
  formatQuotaValue,
  formatQuotaWindow,
  freshnessLabel,
  healthLabel,
  providerDiagnosis,
  providerIds,
  selectActiveProviderId,
  selectProviderHealth,
  selectProviderModelRows,
  selectProviderQuota,
  type ProviderModelRow
} from "./quotaSelectors";

const PROBE_PROVIDERS: readonly ProbeProviderId[] = ["codex_cli", "claude_cli", "agy_cli"];

export type ProviderPaneProps = {
  readonly quotas: readonly ProviderQuota[];
  readonly models?: ProviderModels;
  readonly health?: ProviderHealth;
  readonly readiness?: ReadinessReport | null;
  readonly selectedProvider?: string;
  readonly onSelectProvider?: (provider: string) => void;
  readonly onRefreshProviderStatus?: (providers: readonly ProbeProviderId[]) => Promise<ProbeRefreshResult>;
};

const CLI_PROVIDERS: readonly string[] = ["agy_cli", "claude_cli", "codex_cli"];
const MAX_VISIBLE_MODELS = 20;
const MODEL_SOURCE_LABELS: Readonly<Record<ProviderModelRow["source"], string>> = {
  live_snapshot: "Živě",
  static_fallback: "Katalog",
  mixed: "Kombinace",
  quota_snapshot: "Snímek"
};

function timeLabel(value: string | null | undefined): React.ReactNode {
  if (!value) return <span>Nedostupné</span>;
  return <time dateTime={value}>{value}</time>;
}

export function ProviderPane({ quotas, models, health, readiness, selectedProvider, onSelectProvider, onRefreshProviderStatus }: ProviderPaneProps) {
  const [refreshPending, setRefreshPending] = React.useState(false);
  const [refreshMessage, setRefreshMessage] = React.useState<string | null>(null);
  const ids = providerIds(quotas, models, health);
  const provider = selectActiveProviderId(ids, quotas, health, selectedProvider);
  const quota = selectProviderQuota(quotas, provider);
  const providerHealth = selectProviderHealth(health, provider);
  const providerHealthValue = providerHealth?.health ?? quota?.health;
  const cliVersion = providerHealth?.cli_version ?? quota?.cli_version ?? "Není hlášeno";
  const modelRows = provider === undefined ? [] : selectProviderModelRows(provider, quota, models);
  const diagnosis = provider === undefined ? undefined : providerDiagnosis(provider, quota, health, readiness);
  const sourceFreshness = [quota?.freshness, providerHealth?.freshness, models?.freshness].filter((value): value is string => value !== undefined);
  const freshness = sourceFreshness.includes("stale") ? "stale" : sourceFreshness.includes("fresh") ? "fresh" : "unavailable";
  const staleSources = sourceFreshness.filter((value) => value === "stale").length;
  const refresh = async () => {
    if (onRefreshProviderStatus === undefined || refreshPending) return;
    setRefreshPending(true);
    setRefreshMessage(null);
    try {
      const result = await onRefreshProviderStatus(PROBE_PROVIDERS);
      setRefreshMessage(result.accepted.length > 0
        ? result.rejected.length > 0
          ? "Některé požadavky na obnovení stavu poskytovatelů byly přijaty."
          : "Obnovení stavu poskytovatelů bylo vyžádáno."
        : result.rejected.length > 0
          ? "Požadavek na obnovení stavu poskytovatelů nebyl přijat."
          : "Obnovení stavu poskytovatelů nevrátilo žádné výsledky.");
    } catch {
      setRefreshMessage("Obnovení stavu poskytovatelů selhalo.");
    } finally {
      setRefreshPending(false);
    }
  };

  return <div className="provider-pane">
    <div className="provider-refresh"><button type="button" disabled={refreshPending || onRefreshProviderStatus === undefined} aria-busy={refreshPending} onClick={() => { void refresh(); }}>Obnovit stav poskytovatelů</button>{refreshMessage === null ? null : <p role="status">{refreshMessage}</p>}</div>
    <div className="provider-tabs" role="tablist" aria-label="Poskytovatelé">
      {ids.map((id) => <button key={id} type="button" role="tab" aria-selected={id === provider} onClick={() => onSelectProvider?.(id)}>{id}</button>)}
    </div>
    {provider ? <section aria-labelledby="provider-heading">
      <div className="provider-heading">
        <div>
          <h3 id="provider-heading">{provider}</h3>
          <span className={`provider-freshness provider-freshness-${freshness}`}>{freshnessLabel(freshness)}</span>
        </div>
        <span className={`provider-health provider-health-${providerHealthValue ?? "unavailable"}`}>{healthLabel(providerHealthValue)}</span>
      </div>
      <dl className="provider-meta">
        <div><dt>Načteno</dt><dd>{timeLabel(quota?.fetched_at ?? providerHealth?.fetched_at)}</dd></div>
        <div><dt>Další dotaz</dt><dd>{timeLabel(quota?.next_poll_at ?? providerHealth?.next_poll_at)}</dd></div>
        {CLI_PROVIDERS.includes(provider) ? <div><dt>CLI verze</dt><dd>{cliVersion}</dd></div> : null}
      </dl>
      {diagnosis ? <p className="provider-diagnosis" role="status" data-diagnosis-code={diagnosis.code}>{diagnosis.message}</p> : null}
      {freshness === "stale" ? <p className="provider-warning" role="status">{staleSources > 1 ? "Některá data poskytovatele jsou zastaralá; zobrazeny jsou poslední známé hodnoty." : "Data poskytovatele jsou zastaralá; zobrazeny jsou poslední známé hodnoty."}</p> : null}
      <div className="provider-quota-grid">
        <article><h4>5hodinové okno</h4><p>{formatQuotaWindow(quota?.five_hour)}</p><small>Zbývá: {formatQuotaValue(quota?.five_hour?.remaining)}</small></article>
        <article><h4>Týdenní okno</h4><p>{formatQuotaWindow(quota?.weekly)}</p><small>Zbývá: {formatQuotaValue(quota?.weekly?.remaining)}</small></article>
        <article><h4>Útrata API</h4><p>{typeof quota?.api_spend === "number" ? `${quota.api_spend.toLocaleString()} ${quota.currency ?? ""}` : "Nedostupné"}</p></article>
      </div>
      <section className="provider-models" aria-labelledby="provider-models-heading">
        <h4 id="provider-models-heading">Dostupné modely</h4>
        {modelRows.length > 0 ? <>
          <ul>{modelRows.slice(0, MAX_VISIBLE_MODELS).map((model) => <li key={model.model_id}>
            <div>
              <span>{model.model_id}</span>
              <span className={`model-source-badge model-source-badge-${model.source}`}>{MODEL_SOURCE_LABELS[model.source]}</span>
              {model.reasoning_efforts.length > 0 ? <small className="model-efforts">Uvažování: {model.reasoning_efforts.join(", ")}</small> : null}
            </div>
            <div className="model-state">
              <span className={`model-availability ${model.available ? "model-available" : "model-unavailable"}`}>{model.available ? "Dostupný" : "Nedostupný"}</span>
              <span className="model-health">{healthLabel(model.health, "Stav nedostupný")}</span>
              <small>{timeLabel(model.updated_at)}</small>
            </div>
          </li>)}</ul>
          {modelRows.length > MAX_VISIBLE_MODELS ? <p className="provider-model-truncation">Zobrazeno {MAX_VISIBLE_MODELS} z {modelRows.length} modelů.</p> : null}
        </> : <p>Žádné modely k zobrazení.</p>}
      </section>
    </section> : null}
  </div>;
}
