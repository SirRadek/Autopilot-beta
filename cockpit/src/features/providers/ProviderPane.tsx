import React from "react";
import type { ProviderHealth, ProviderModels, ProviderQuota } from "../../types/controlPlane";
import { formatQuotaValue, formatQuotaWindow, freshnessLabel, providerIds, selectProviderHealth, selectProviderModels, selectProviderQuota } from "./quotaSelectors";

export type ProviderPaneProps = {
  readonly quotas: readonly ProviderQuota[];
  readonly models?: ProviderModels;
  readonly health?: ProviderHealth;
  readonly selectedProvider?: string;
  readonly onSelectProvider?: (provider: string) => void;
};

function timeLabel(value: string | null | undefined): React.ReactNode {
  if (!value) return <span>Unavailable</span>;
  return <time dateTime={value}>{value}</time>;
}

export function ProviderPane({ quotas, models, health, selectedProvider, onSelectProvider }: ProviderPaneProps) {
  const ids = providerIds(quotas, models, health);
  const provider = selectedProvider && ids.includes(selectedProvider) ? selectedProvider : ids[0];
  const quota = selectProviderQuota(quotas, provider);
  const providerHealth = selectProviderHealth(health, provider);
  const providerModels = selectProviderModels(quota, models, provider);
  const sourceFreshness = [quota?.freshness, providerHealth?.freshness, models?.freshness].filter((value): value is string => value !== undefined);
  const freshness = sourceFreshness.includes("stale") ? "stale" : sourceFreshness.includes("fresh") ? "fresh" : "unavailable";
  const staleSources = sourceFreshness.filter((value) => value === "stale").length;
  return <div className="provider-pane">
    {ids.length > 0 ? <div className="provider-tabs" role="tablist" aria-label="Providers">{ids.map((id) => <button key={id} type="button" role="tab" aria-selected={id === provider} onClick={() => onSelectProvider?.(id)}>{id}</button>)}</div> : <p className="provider-empty">No provider data available.</p>}
    {provider ? <section aria-labelledby="provider-heading">
      <div className="provider-heading"><div><h3 id="provider-heading">{provider}</h3><span className={`provider-freshness provider-freshness-${freshness ?? "unavailable"}`}>{freshnessLabel(freshness)}</span></div><span className={`provider-health provider-health-${providerHealth?.health ?? quota?.health ?? "unavailable"}`}>{providerHealth?.health ?? quota?.health ?? "Unavailable"}</span></div>
      <dl className="provider-meta"><div><dt>Fetched</dt><dd>{timeLabel(quota?.fetched_at ?? providerHealth?.fetched_at)}</dd></div><div><dt>Next poll</dt><dd>{timeLabel(quota?.next_poll_at ?? providerHealth?.next_poll_at)}</dd></div></dl>
      {freshness === "stale" ? <p className="provider-warning" role="status">{staleSources > 1 ? "Some provider data is stale; last known values shown." : "Provider data is stale; last known values shown."}</p> : null}
      <div className="provider-quota-grid"><article><h4>5-hour window</h4><p>{quota ? formatQuotaWindow(quota.five_hour) : "Unavailable"}</p><small>Remaining: {quota ? formatQuotaValue(quota.five_hour.remaining) : "Unavailable"}</small></article><article><h4>Weekly window</h4><p>{quota ? formatQuotaWindow(quota.weekly) : "Unavailable"}</p><small>Remaining: {quota ? formatQuotaValue(quota.weekly.remaining) : "Unavailable"}</small></article><article><h4>API spend</h4><p>{quota?.api_spend === null || quota?.api_spend === undefined ? "Unavailable" : `${quota.api_spend.toLocaleString()} ${quota.currency ?? ""}`}</p></article></div>
      <section className="provider-models" aria-labelledby="provider-models-heading"><h4 id="provider-models-heading">Available models</h4>{providerModels.length ? <ul>{providerModels.slice(0, 12).map((model) => <li key={model.model_id}><div><span>{model.model_id}</span><small className="model-provider">{model.source || provider}</small></div><div className="model-state"><span className={model.available ? "model-available" : "model-unavailable"}>{model.available ? "Available" : "Unavailable"}</span><span className="model-health">{model.health || "Health unavailable"}</span><small>{timeLabel(model.updated_at ?? model.fetched_at ?? quota?.fetched_at)}</small></div></li>)}</ul> : <p>Unavailable</p>}</section>
    </section> : null}
  </div>;
}
