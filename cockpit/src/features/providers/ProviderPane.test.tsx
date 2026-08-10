import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import type { ProbeRefreshResult, ProviderHealth, ProviderModels, ProviderQuota, ReadinessProviderId, ReadinessReport, ReadinessStatus } from "../../types/controlPlane";
import { CANONICAL_PROVIDERS, formatQuotaWindow, healthLabel, providerIds, selectProviderModelRows } from "./quotaSelectors";
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

  it("localizes known health values and the missing-health fallback", () => {
    expect(healthLabel("healthy, ok, degraded, error, unavailable")).toBe("V pořádku, V pořádku, Omezené, Chyba, Nedostupné");
    expect(healthLabel(undefined, "Stav nedostupný")).toBe("Stav nedostupný");
  });
});

describe("ProviderPane", () => {
  it("defaults to the first provider with a quota snapshot and usable health", () => {
    const unknownHealthQuota = { provider: "claude_cli" } as ProviderQuota;
    const healthyByProviderHealth: ProviderQuota = { ...quota, health: "unavailable" };
    const providerHealth: ProviderHealth = {
      providers: [
        { ...health.providers[0], provider: "agy_cli", health: "unavailable", freshness: "unavailable" },
        health.providers[0]
      ]
    };
    const { host, root } = mount(<ProviderPane quotas={[unknownHealthQuota, healthyByProviderHealth]} health={providerHealth} />);

    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([...CANONICAL_PROVIDERS]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("openrouter_api");
    expect(host.querySelector(".provider-heading h3")?.textContent).toBe("openrouter_api");

    unmount(host, root);
  });

  it("falls back to the first alphabetical tab when no provider has quota data", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} health={health} />);

    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("agy_cli");
    expect(host.querySelector(".provider-heading h3")?.textContent).toBe("agy_cli");

    unmount(host, root);
  });

  it("falls back to the first quota snapshot when every snapshot is unavailable", () => {
    const unavailableCodexQuota: ProviderQuota = {
      ...quota,
      provider: "codex_cli",
      health: "unavailable",
      freshness: "unavailable"
    };
    const { host, root } = mount(<ProviderPane quotas={[unavailableCodexQuota]} />);

    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("codex_cli");
    expect(host.querySelector(".provider-heading h3")?.textContent).toBe("codex_cli");

    unmount(host, root);
  });

  it("keeps an explicit provider selection even when that provider is unavailable", () => {
    const unavailableAgyQuota: ProviderQuota = {
      ...quota,
      provider: "agy_cli",
      health: "unavailable",
      freshness: "unavailable"
    };
    const { host, root } = mount(<ProviderPane quotas={[unavailableAgyQuota, quota]} selectedProvider="agy_cli" />);

    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("agy_cli");
    expect(host.querySelector(".provider-heading h3")?.textContent).toBe("agy_cli");

    unmount(host, root);
  });

  it("always renders all canonical tabs and explains an absent readiness endpoint", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} readiness={null} />);

    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([...CANONICAL_PROVIDERS]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("agy_cli");
    expect(host.querySelector('[data-diagnosis-code="not_observed"]')?.textContent).toBe("Diagnostika není dostupná: endpoint /ready není na tomto nasazení publikován a server nehlásí žádný snímek.");

    unmount(host, root);
  });

  it("renders the readiness diagnosis for an unconfigured Claude probe", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} readiness={readinessWith("claude_cli", "unavailable", "probe_not_configured")} selectedProvider="claude_cli" />);

    expect(host.querySelector('[data-diagnosis-code="probe_not_configured"]')?.textContent).toBe("Sonda využití není na serveru nakonfigurována — CLI není v konfiguraci control plane.");

    unmount(host, root);
  });

  it("explains a Claude API-billing account that has no quota windows", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} readiness={readinessWith("claude_cli", "unavailable", "quota_not_applicable")} selectedProvider="claude_cli" />);

    expect(host.querySelector('[data-diagnosis-code="quota_not_applicable"]')?.textContent).toBe("Účet používá dolarové API účtování bez kvótových oken (session/týden) — sonda proto nemá žádnou kvótu, kterou by mohla hlásit.");

    unmount(host, root);
  });

  it("renders the missing-credential diagnosis for OpenRouter", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} readiness={readinessWith("openrouter_api", "unavailable", "missing_credential")} selectedProvider="openrouter_api" />);

    expect(host.querySelector('[data-diagnosis-code="missing_credential"]')?.textContent).toBe("Chybí přihlašovací údaje (credential) pro tohoto poskytovatele.");

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
    expect(catalogRow?.querySelector(".model-health")?.textContent).toBe("Nedostupné");
    expect(catalogRow?.textContent).toContain("Uvažování: low");
    expect(catalogRow?.querySelector("time")?.dateTime).toBe("2026-07-11T10:03:00.000Z");
    expect(liveRow?.textContent).toContain("Živě");
    expect(liveRow?.textContent).toContain("Dostupný");
    expect(liveRow?.querySelector(".model-health")?.textContent).toBe("V pořádku");
    expect(liveRow?.textContent).toContain("Uvažování: medium, high");
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

  it("renders the reported CLI version only for CLI providers", () => {
    const cliHealth: ProviderHealth = {
      providers: [{ ...health.providers[0], provider: "codex_cli", cli_version: "codex-cli 1.2.3" }]
    };
    const cli = mount(<ProviderPane quotas={[]} health={cliHealth} selectedProvider="codex_cli" />);
    const cliVersion = [...cli.host.querySelectorAll(".provider-meta > div")].find((row) => row.querySelector("dt")?.textContent === "CLI verze");
    expect(cliVersion?.querySelector("dd")?.textContent).toBe("codex-cli 1.2.3");
    expect(cli.host.querySelector(".planned-badge")).toBeNull();
    unmount(cli.host, cli.root);

    const api = mount(<ProviderPane quotas={[{ ...quota, cli_version: "openrouter 9.9.9" }]} selectedProvider="openrouter_api" />);
    expect(api.host.textContent).not.toContain("CLI verze");
    expect(api.host.textContent).not.toContain("openrouter 9.9.9");
    unmount(api.host, api.root);
  });

  it("renders a clear Czech fallback when the CLI version is null", () => {
    const cliQuota: ProviderQuota = { ...quota, provider: "claude_cli", cli_version: null };
    const { host, root } = mount(<ProviderPane quotas={[cliQuota]} selectedProvider="claude_cli" />);
    const cliVersion = [...host.querySelectorAll(".provider-meta > div")].find((row) => row.querySelector("dt")?.textContent === "CLI verze");

    expect(cliVersion?.querySelector("dd")?.textContent).toBe("Není hlášeno");
    expect(host.querySelector(".planned-badge")).toBeNull();

    unmount(host, root);
  });

  it("renders fresh windows, zero usage, spend and quota snapshot models", () => {
    const { host, root } = mount(<ProviderPane quotas={[quota]} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("Čerstvé");
    expect(host.textContent).toContain("V pořádku");
    expect(host.textContent).toContain("Načteno");
    expect(host.textContent).toContain("Další dotaz");
    expect(host.textContent).toContain("5hodinové okno");
    expect(host.textContent).toContain("Zbývá: 1,000");
    expect(host.textContent).toContain("Týdenní okno");
    expect(host.textContent).toContain("Útrata API");
    expect(host.textContent).toContain("Dostupné modely");
    expect(host.textContent).toContain("0 / 1,000 (0%)");
    expect(host.textContent).toContain("1.25 USD");
    expect(host.textContent).toContain("nvidia/nemotron");
    expect(host.textContent).toContain("Snímek");
    unmount(host, root);
  });

  it("renders stale warning", () => {
    const { host, root } = mount(<ProviderPane quotas={[staleQuota]} health={health} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("Zastaralé");
    expect(host.textContent).toContain("Data poskytovatele jsou zastaralá");
    unmount(host, root);
  });

  it("does not hide stale model or health data behind a fresh quota", () => {
    const { host, root } = mount(<ProviderPane quotas={[quota]} models={{ ...models, freshness: "stale" }} health={{ ...health, providers: [{ ...health.providers[0], freshness: "stale" }] }} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("Některá data poskytovatele jsou zastaralá");
    expect(host.querySelector(".provider-freshness-stale")).not.toBeNull();
    unmount(host, root);
  });

  it("renders unavailable or null values and model API data", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} models={models} health={health} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("Nedostupné");
    expect(host.textContent).toContain("fallback-model");
    unmount(host, root);
  });

  it("renders unavailable values when provider snapshots are partial", () => {
    const partialQuota = { provider: "openrouter_api" } as ProviderQuota;
    const { host, root } = mount(
      <ProviderPane
        quotas={[partialQuota]}
        models={{} as ProviderModels}
        health={{} as ProviderHealth}
        readiness={{} as ReadinessReport}
        selectedProvider="openrouter_api"
      />,
    );

    expect(host.querySelector(".provider-heading h3")?.textContent).toBe("openrouter_api");
    expect(host.textContent).toContain("Nedostupné");
    expect(host.textContent).toContain("Žádné modely k zobrazení.");

    unmount(host, root);
  });

  it("renders provider, availability, health and model update metadata", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} models={models} health={health} selectedProvider="openrouter_api" />);
    expect(host.textContent).toContain("openrouter_api");
    expect(host.textContent).toContain("Dostupný");
    expect(host.textContent).toContain("V pořádku");
    expect(host.textContent).toContain("2026-07-11T10:01:00.000Z");
    expect(host.textContent).toContain("Načteno");
    expect(host.textContent).toContain("Další dotaz");
    unmount(host, root);
  });

  it("maps unavailable provider-health error codes without leaking implementation detail", () => {
    const { host, root } = mount(<ProviderPane quotas={[]} health={{ providers: [{ provider: "codex_cli", health: "unavailable", freshness: "unavailable", fetched_at: "", next_poll_at: null, error_code: "provider_unavailable" }] }} selectedProvider="codex_cli" />);
    expect(host.textContent).toContain("Nedostupné");
    expect(host.textContent).toContain("Poskytovatel je aktuálně nedostupný.");
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
    expect(vanished.host.querySelector(".provider-heading h3")?.textContent).toBe("openrouter_api");
    unmount(vanished.host, vanished.root);
  });

  it("has no axe violations", async () => {
    const { host, root } = mount(<ProviderPane quotas={[quota]} selectedProvider="openrouter_api" />);
    const result = await axe.run(host, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
    unmount(host, root);
  });

  it("formats null windows as unavailable", () => {
    expect(formatQuotaWindow({ limit: null, used: 1, remaining: null, resets_at: null })).toBe("Nedostupné");
  });
  it("requests all fixed provider probes and stays disabled while pending", async () => {
    let resolveRefresh: ((result: ProbeRefreshResult) => void) | undefined;
    const onRefresh = vi.fn(() => new Promise<ProbeRefreshResult>((resolve) => { resolveRefresh = resolve; }));
    const { host, root } = mount(<ProviderPane quotas={[quota]} onRefreshProviderStatus={onRefresh} />);
    const button = host.querySelector(".provider-refresh button") as HTMLButtonElement;

    expect(button.textContent).toBe("Obnovit stav poskytovatelů");

    act(() => button.click());

    expect(button.disabled).toBe(true);
    expect(onRefresh).toHaveBeenCalledWith(["codex_cli", "claude_cli", "agy_cli"]);

    await act(async () => {
      resolveRefresh?.({ accepted: ["codex_cli"], rejected: ["claude_cli", "agy_cli"], expires_at: "2026-07-11T12:10:00.000Z" });
      await Promise.resolve();
    });

    expect(button.disabled).toBe(false);
    expect(host.textContent).toContain("Některé požadavky na obnovení stavu poskytovatelů byly přijaty.");
    act(() => root.unmount()); host.remove();
  });
  it("uses localized full-refresh copy when every provider is accepted", async () => {
    const onRefresh = vi.fn().mockResolvedValue({ accepted: ["codex_cli", "claude_cli", "agy_cli"], rejected: [], expires_at: "2026-07-11T12:10:00.000Z" } satisfies ProbeRefreshResult);
    const { host, root } = mount(<ProviderPane quotas={[quota]} onRefreshProviderStatus={onRefresh} />);
    const button = host.querySelector(".provider-refresh button") as HTMLButtonElement;

    await act(async () => { button.click(); await Promise.resolve(); });

    expect(host.textContent).toContain("Obnovení stavu poskytovatelů bylo vyžádáno.");
    act(() => root.unmount()); host.remove();
  });
  it("uses neutral fixed copy when cooldown rejects every provider", async () => {
    const onRefresh = vi.fn().mockResolvedValue({ accepted: [], rejected: ["codex_cli", "claude_cli", "agy_cli"], expires_at: "2026-07-11T12:10:00.000Z" });
    const { host, root } = mount(<ProviderPane quotas={[quota]} onRefreshProviderStatus={onRefresh} />);
    const button = host.querySelector(".provider-refresh button") as HTMLButtonElement;

    await act(async () => { button.click(); await Promise.resolve(); });

    expect(host.textContent).toContain("Požadavek na obnovení stavu poskytovatelů nebyl přijat.");
    expect(host.textContent).not.toContain("není nakonfigurován");
    act(() => root.unmount()); host.remove();
  });
  it("uses localized no-results copy when refresh returns no provider decisions", async () => {
    const onRefresh = vi.fn().mockResolvedValue({ accepted: [], rejected: [], expires_at: "2026-07-11T12:10:00.000Z" } satisfies ProbeRefreshResult);
    const { host, root } = mount(<ProviderPane quotas={[quota]} onRefreshProviderStatus={onRefresh} />);
    const button = host.querySelector(".provider-refresh button") as HTMLButtonElement;

    await act(async () => { button.click(); await Promise.resolve(); });

    expect(host.textContent).toContain("Obnovení stavu poskytovatelů nevrátilo žádné výsledky.");
    act(() => root.unmount()); host.remove();
  });
  it("renders a fixed refresh failure without exposing rejected details", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("secret provider stderr"));
    const { host, root } = mount(<ProviderPane quotas={[quota]} onRefreshProviderStatus={onRefresh} />);
    const button = host.querySelector(".provider-refresh button") as HTMLButtonElement;

    await act(async () => { button.click(); await Promise.resolve(); });

    expect(host.textContent).toContain("Obnovení stavu poskytovatelů selhalo.");
    expect(host.textContent).not.toContain("secret provider stderr");
    act(() => root.unmount()); host.remove();
  });
});
