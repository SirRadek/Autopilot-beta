import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import type { ProbeRefreshResult, ProviderHealth, ProviderModels, ProviderQuota, ReadinessProviderId, ReadinessReport, ReadinessStatus } from "../../types/controlPlane";
import { CANONICAL_PROVIDERS, formatQuotaWindow, providerIds, selectProviderModelRows } from "./quotaSelectors";
import { ProviderPane } from "./ProviderPane";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const quota: ProviderQuota = {
  provider: "openrouter_api",
  source: "probe",
  fetched_at: "2026-07-11T10:00:00.000Z",
  observed_at: "2026-07-11T10:00:00.000Z",
  five_hour: { limit: 1000, used: 0, remaining: 1000, resets_at: "2026-07-11T15:00:00.000Z" },
  weekly: { limit: null, used: 12, remaining: null, resets_at: null },
  api_spend: 1.25,
  currency: "USD",
  models: [{ model_id: "nvidia/nemotron", available: true, health: "healthy", source: "Nvidia" }],
  health: "healthy",
  error_code: null,
  freshness: "fresh",
  next_poll_at: "2026-07-11T10:05:00.000Z"
};
const staleQuota = { ...quota, freshness: "stale" as const, api_spend: null, models: [] };
const health: ProviderHealth = {
  providers: [{ provider: "openrouter_api", health: "healthy", freshness: "fresh", fetched_at: quota.fetched_at, next_poll_at: quota.next_poll_at, error_code: null }]
};
const models: ProviderModels = {
  freshness: "fresh",
  fetched_at: quota.fetched_at,
  next_poll_at: quota.next_poll_at,
  models: [{
    model_id: "fallback-model",
    providers: ["openrouter_api"],
    available: true,
    health: ["healthy"],
    source: "static_fallback",
    reasoning_efforts: [],
    updated_at: "2026-07-11T10:01:00.000Z"
  }]
};

function readinessWith(provider: ReadinessProviderId, status: ReadinessStatus, errorCode: string | null): ReadinessReport {
  const ready = { status: "ready" as const, error_code: null };
  return {
    ready: status === "ready",
    status,
    checked_at: "2026-07-11T10:02:00.000Z",
    components: {
      configuration: ready,
      authentication: ready,
      managed_state: ready,
      project_registry: ready,
      supervisor: ready,
      token_gateway: ready,
      providers: {
        agy_cli: provider === "agy_cli" ? { status, error_code: errorCode } : ready,
        claude_cli: provider === "claude_cli" ? { status, error_code: errorCode } : ready,
        codex_cli: provider === "codex_cli" ? { status, error_code: errorCode } : ready,
        openrouter_api: provider === "openrouter_api" ? { status, error_code: errorCode } : ready
      }
    }
  };
}

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

function unmount(host: HTMLElement, root: ReturnType<typeof createRoot>) {
  act(() => root.unmount());
  host.remove();
}

describe("quotaSelectors", () => {
  it("returns the sorted union of canonical and observed provider ids", () => {
    const customQuota = { ...quota, provider: "zeta_cli" };
    const ids = providerIds([customQuota], {
      ...models,
      models: [{ ...models.models[0], providers: ["beta_api"] }]
    }, {
      providers: [{ ...health.providers[0], provider: "alpha_cli" }]
    });

    expect(ids).toEqual(["agy_cli", "alpha_cli", "beta_api", "claude_cli", "codex_cli", "openrouter_api", "zeta_cli"]);
  });

  it("uses provider-route metadata and sorts available model rows first", () => {
    const routedModels: ProviderModels = {
      ...models,
      models: [
        {
          model_id: "a-catalog",
          providers: ["claude_cli"],
          available: true,
          health: ["healthy"],
          source: "mixed",
          reasoning_efforts: ["max"],
          provider_routes: [{ provider: "claude_cli", available: false, health: ["unavailable"], source: "static_fallback", reasoning_efforts: ["low"] }],
          fetched_at: "2026-07-11T10:03:00.000Z"
        },
        {
          model_id: "z-live",
          providers: ["claude_cli"],
          available: false,
          health: ["unavailable"],
          source: "mixed",
          reasoning_efforts: [],
          provider_routes: [{ provider: "claude_cli", available: true, health: ["healthy", "warm"], source: "live_snapshot", reasoning_efforts: ["medium", "high"] }],
          updated_at: "2026-07-11T10:04:00.000Z"
        }
      ]
    };

    expect(selectProviderModelRows("claude_cli", undefined, routedModels)).toEqual([
      { model_id: "z-live", available: true, health: "healthy, warm", source: "live_snapshot", reasoning_efforts: ["medium", "high"], updated_at: "2026-07-11T10:04:00.000Z" },
      { model_id: "a-catalog", available: false, health: "unavailable", source: "static_fallback", reasoning_efforts: ["low"], updated_at: "2026-07-11T10:03:00.000Z" }
    ]);
  });

  it("falls back to quota model rows when the provider catalog is empty", () => {
    expect(selectProviderModelRows("openrouter_api", quota, undefined)).toEqual([
      { model_id: "nvidia/nemotron", available: true, health: "healthy", source: "quota_snapshot", reasoning_efforts: [], updated_at: quota.fetched_at }
    ]);
  });
});

describe("ProviderPane", () => {
  it("always renders all canonical tabs and explains an absent readiness endpoint", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} readiness={null} />);

    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([...CANONICAL_PROVIDERS]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("agy_cli");
    expect(host.querySelector('[data-diagnosis-code="not_observed"]')?.textContent).toBe("Diagnostika není dostupná: endpoint /ready není na tomto nasazení publikován a server nehlásí žádný snapshot.");

    unmount(host, root);
  });

  it("renders the readiness diagnosis for an unconfigured Claude probe", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} readiness={readinessWith("claude_cli", "unavailable", "probe_not_configured")} selectedProvider="claude_cli" />);

    expect(host.querySelector('[data-diagnosis-code="probe_not_configured"]')?.textContent).toBe("Sonda využití není na serveru nakonfigurována — CLI není v konfiguraci control plane.");

    unmount(host, root);
  });

  it("renders the missing-credential diagnosis for OpenRouter", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} readiness={readinessWith("openrouter_api", "unavailable", "missing_credential")} selectedProvider="openrouter_api" />);

    expect(host.querySelector('[data-diagnosis-code="missing_credential"]')?.textContent).toBe("Chybí přihlašovací údaje (credential) pro tohoto providera.");

    unmount(host, root);
  });

  it("renders route provenance, availability, efforts and timestamps per provider", () => {
    const routedModels: ProviderModels = {
      ...models,
      models: [
        {
          model_id: "catalog-model",
          providers: ["claude_cli"],
          available: true,
          health: ["healthy"],
          source: "mixed",
          reasoning_efforts: ["max"],
          provider_routes: [{ provider: "claude_cli", available: false, health: ["unavailable"], source: "static_fallback", reasoning_efforts: ["low"] }],
          updated_at: "2026-07-11T10:03:00.000Z"
        },
        {
          model_id: "live-model",
          providers: ["claude_cli"],
          available: false,
          health: ["unavailable"],
          source: "mixed",
          reasoning_efforts: [],
          provider_routes: [{ provider: "claude_cli", available: true, health: ["healthy"], source: "live_snapshot", reasoning_efforts: ["medium", "high"] }],
          updated_at: "2026-07-11T10:04:00.000Z"
        }
      ]
    };
    const { host, root } = mount(<ProviderPane quotas={[]} models={routedModels} selectedProvider="claude_cli" />);
    const rows = [...host.querySelectorAll(".provider-models li")];
    const catalogRow = rows.find((row) => row.textContent?.includes("catalog-model"));
    const liveRow = rows.find((row) => row.textContent?.includes("live-model"));

    expect(catalogRow?.textContent).toContain("Katalog");
    expect(catalogRow?.textContent).toContain("Nedostupný");
    expect(catalogRow?.textContent).toContain("efforts: low");
    expect(catalogRow?.querySelector("time")?.dateTime).toBe("2026-07-11T10:03:00.000Z");
    expect(liveRow?.textContent).toContain("Živě");
    expect(liveRow?.textContent).toContain("Dostupný");
    expect(liveRow?.textContent).toContain("efforts: medium, high");
    expect(liveRow?.querySelector("time")?.dateTime).toBe("2026-07-11T10:04:00.000Z");

    unmount(host, root);
  });

  it("caps model rows at twenty and renders the exact truncation marker", () => {
    const manyModels: ProviderModels = {
      ...models,
      models: Array.from({ length: 21 }, (_, index) => ({
        model_id: `model-${String(index).padStart(2, "0")}`,
        providers: ["openrouter_api"],
        available: true,
        health: ["healthy"],
        source: "static_fallback" as const,
        reasoning_efforts: []
      }))
    };
    const { host, root } = mount(<ProviderPane quotas={[]} models={manyModels} selectedProvider="openrouter_api" />);

    expect(host.querySelectorAll(".provider-models li")).toHaveLength(20);
    expect(host.textContent).toContain("Zobrazeno 20 z 21 modelů.");

    unmount(host, root);
  });

  it("shows the Phase 2 CLI-version slot only for CLI providers", () => {
    const cli = mount(<ProviderPane quotas={[]} selectedProvider="codex_cli" />);
    expect(cli.host.textContent).toContain("CLI verze");
    expect(cli.host.textContent).toContain("zatím nehlášeno");
    expect(cli.host.textContent).toContain("Phase 2");
    unmount(cli.host, cli.root);

    const api = mount(<ProviderPane quotas={[]} selectedProvider="openrouter_api" />);
    expect(api.host.textContent).not.toContain("CLI verze");
    unmount(api.host, api.root);
  });

  it("renders fresh windows, zero usage, spend and quota snapshot models", () => {
    const { host, root } = mount(<ProviderPane quotas={[quota]} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("Fresh");
    expect(host.textContent).toContain("0 / 1,000 (0%)");
    expect(host.textContent).toContain("1.25 USD");
    expect(host.textContent).toContain("nvidia/nemotron");
    expect(host.textContent).toContain("Snapshot");
    unmount(host, root);
  });

  it("renders stale warning", () => {
    const { host, root } = mount(<ProviderPane quotas={[staleQuota]} health={health} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("Stale");
    expect(host.textContent).toContain("Provider data is stale");
    unmount(host, root);
  });

  it("does not hide stale model or health data behind a fresh quota", () => {
    const { host, root } = mount(<ProviderPane quotas={[quota]} models={{ ...models, freshness: "stale" }} health={{ ...health, providers: [{ ...health.providers[0], freshness: "stale" }] }} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("Some provider data is stale");
    expect(host.querySelector(".provider-freshness-stale")).not.toBeNull();
    unmount(host, root);
  });

  it("renders unavailable or null values and model API data", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} models={models} health={health} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("Unavailable");
    expect(host.textContent).toContain("fallback-model");
    unmount(host, root);
  });

  it("renders provider, availability, health and model update metadata", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} models={models} health={health} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("openrouter_api");
    expect(host.textContent).toContain("Dostupný");
    expect(host.textContent).toContain("healthy");
    expect(host.textContent).toContain("2026-07-11T10:01:00.000Z");
    expect(host.textContent).toContain("Fetched");
    expect(host.textContent).toContain("Next poll");
    unmount(host, root);
  });

  it("maps unavailable provider-health error codes without leaking implementation detail", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} health={{ providers: [{ provider: "codex_cli", health: "unavailable", freshness: "unavailable", fetched_at: "", next_poll_at: null, error_code: "provider_unavailable" }] }} selectedProvider="codex_cli" />);
    expect(host.textContent).toContain("unavailable");
    expect(host.textContent).toContain("Provider je aktuálně nedostupný.");
    expect(host.textContent).not.toContain("provider_unavailable");
    unmount(host, root);
  });

  it("supports provider tabs", () => {
    const calls: string[] = [];
    const { host, root } = mount(<ProviderPane quotas={[quota, { ...quota, provider: "claude_cli" }]} onSelectProvider={(provider) => calls.push(provider)} selectedProvider="openrouter_api" />);
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "claude_cli") as HTMLButtonElement;
    act(() => button.click());
    expect(calls).toEqual(["claude_cli"]);
    unmount(host, root);
  });

  it("keeps a present custom selection and safely falls back when it disappears on refresh", () => {
    const custom = { ...quota, provider: "zeta_cli" };
    const kept = mount(<ProviderPane quotas={[quota, custom]} selectedProvider="zeta_cli" />);
    expect(kept.host.querySelector(".provider-heading h3")?.textContent).toBe("zeta_cli");
    unmount(kept.host, kept.root);

    const vanished = mount(<ProviderPane quotas={[quota]} selectedProvider="zeta_cli" />);
    expect(vanished.host.querySelector(".provider-heading h3")?.textContent).toBe("agy_cli");
    unmount(vanished.host, vanished.root);
  });

  it("has no axe violations", async () => {
    const { host, root } = mount(<ProviderPane quotas={[quota]} selectedProvider="openrouter_api" />);
    const result = await axe.run(host, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
    unmount(host, root);
  });

  it("formats null windows as unavailable", () => {
    expect(formatQuotaWindow({ limit: null, used: 1, remaining: null, resets_at: null })).toBe("Unavailable");
  });
  it("requests all fixed provider probes and stays disabled while pending", async () => {
    let resolveRefresh: ((result: ProbeRefreshResult) => void) | undefined;
    const onRefresh = vi.fn(() => new Promise<ProbeRefreshResult>((resolve) => { resolveRefresh = resolve; }));
    const { host, root } = mount(<ProviderPane quotas={[quota]} onRefreshProviderStatus={onRefresh} />);
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Refresh provider status") as HTMLButtonElement;

    act(() => button.click());

    expect(button.disabled).toBe(true);
    expect(onRefresh).toHaveBeenCalledWith(["codex_cli", "claude_cli", "agy_cli"]);

    await act(async () => {
      resolveRefresh?.({ accepted: ["codex_cli"], rejected: ["claude_cli", "agy_cli"], expires_at: "2026-07-11T12:10:00.000Z" });
      await Promise.resolve();
    });

    expect(button.disabled).toBe(false);
    expect(host.textContent).toContain("Some provider status refresh requests were accepted.");
    act(() => root.unmount()); host.remove();
  });
  it("uses neutral fixed copy when cooldown rejects every provider", async () => {
    const onRefresh = vi.fn().mockResolvedValue({ accepted: [], rejected: ["codex_cli", "claude_cli", "agy_cli"], expires_at: "2026-07-11T12:10:00.000Z" });
    const { host, root } = mount(<ProviderPane quotas={[quota]} onRefreshProviderStatus={onRefresh} />);
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Refresh provider status") as HTMLButtonElement;

    await act(async () => { button.click(); await Promise.resolve(); });

    expect(host.textContent).toContain("Provider status refresh request was not accepted.");
    expect(host.textContent).not.toContain("not configured");
    act(() => root.unmount()); host.remove();
  });
  it("renders a fixed refresh failure without exposing rejected details", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("secret provider stderr"));
    const { host, root } = mount(<ProviderPane quotas={[quota]} onRefreshProviderStatus={onRefresh} />);
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Refresh provider status") as HTMLButtonElement;

    await act(async () => { button.click(); await Promise.resolve(); });

    expect(host.textContent).toContain("Provider status refresh failed.");
    expect(host.textContent).not.toContain("secret provider stderr");
    act(() => root.unmount()); host.remove();
  });
});
