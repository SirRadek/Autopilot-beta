import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { ControlPlaneClient } from "../api/controlPlaneClient";
import type { AutopilotIncident, PromotionPacket, ProviderQuota, RunRecord } from "../types/controlPlane";
import { AuthenticatedCockpit } from "./App";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const now = "2026-07-21T10:00:00.000Z";
function providerQuota(provider: string): ProviderQuota {
  return { provider, source: "cli", fetched_at: now, observed_at: now, five_hour: { limit: 1000, used: 0, remaining: 1000, resets_at: null }, weekly: { limit: 5000, used: 0, remaining: 5000, resets_at: null }, api_spend: null, currency: null, models: [], health: "healthy", error_code: null, freshness: "fresh", next_poll_at: null };
}

function fakeClient(overrides: Partial<ControlPlaneClient> = {}): ControlPlaneClient {
  return {
    getAuthSession: vi.fn().mockResolvedValue({ authenticated: true }), login: vi.fn(), logout: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ sessions: { total: 0, active: 0, closed: 0 }, approvals: { total: 0, pending: 0, approved: 0, rejected: 0 }, telemetry: { calls: 0, successful: 0, total_tokens: 0 } }),
    getSessions: vi.fn().mockResolvedValue([]), getApprovals: vi.fn().mockResolvedValue([]), getWorkers: vi.fn().mockResolvedValue([]),
    getProjects: vi.fn().mockResolvedValue([]), getRuns: vi.fn().mockResolvedValue([]), listRuns: vi.fn().mockResolvedValue([]), getRun: vi.fn(), prepareRun: vi.fn(), reviseRun: vi.fn(), approveRun: vi.fn(), cancelRun: vi.fn(),
    listPromotions: vi.fn().mockResolvedValue([]),
    getIncidents: vi.fn().mockResolvedValue([]), acknowledgeIncident: vi.fn(), prepareRepairPacket: vi.fn(),
    listFigmaMutations: vi.fn().mockResolvedValue([]), decideFigmaMutation: vi.fn(),
    listBrainstorms: vi.fn().mockResolvedValue([]), getBrainstorm: vi.fn(), createBrainstorm: vi.fn(), approveBrainstorm: vi.fn(), arbitrateBrainstorm: vi.fn(), cancelBrainstorm: vi.fn(),
    getObservabilitySummary: vi.fn().mockResolvedValue({ events: 0, tokens: 0, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }),
    getObservabilityTimeline: vi.fn().mockResolvedValue({ summary: { events: 0, tokens: 0, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }, timeline: [], limits: { files_scanned: 0, max_bytes_per_file: 0, max_lines_per_file: 0, max_events: 100, truncated: false } }),
    createSession: vi.fn(), mutateSession: vi.fn(),
    getProviderQuotas: vi.fn().mockResolvedValue({ providers: [providerQuota("claude_cli"), providerQuota("codex_cli")] }),
    getProviderModels: vi.fn().mockResolvedValue({ freshness: "fresh", fetched_at: now, next_poll_at: null, models: [] }),
    getProviderHealth: vi.fn().mockResolvedValue({ providers: [] }),
    getReadiness: vi.fn().mockResolvedValue(null),
    refreshProviderProbes: vi.fn().mockResolvedValue({ accepted: [], rejected: ["codex_cli", "claude_cli", "agy_cli"], expires_at: now }),
    decideApproval: vi.fn(), ...overrides,
  } as ControlPlaneClient;
}

const completedDevRun: RunRecord = {
  schema_version: "v1", current: { run_id: "run-dev-1", revision: 2, project_id: "autopilot-beta", prompt: "Publish showcase", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, input_token_bound: 200, output_token_allowance: 200, requested_artifacts: ["text"], prompt_review_acknowledged: true, profile: "dev", requested_reasoning_effort: "high", promotion_packet_id: null, created_at: now }, revisions: [], status: "completed", approved_revision: 2, approved_by: "owner", approved_at: now, supervisor_task_id: null, worker_run_id: "worker-1", terminal_reason: null, token_reservation: null, reservation_status: "settled", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: now,
};
const pendingDraftRun: RunRecord = {
  ...completedDevRun,
  current: { ...completedDevRun.current, run_id: "run-draft-1", revision: 4, prompt: "Review this draft" },
  status: "draft",
  approved_revision: null,
  approved_by: null,
  approved_at: null,
  worker_run_id: null,
  reservation_status: "none",
};
const verifiedPacket: PromotionPacket = { schema_version: "v1", packet_id: "packet-1", source_run_id: "run-dev-1", source_revision: 2, intent: "Publish", artifact_hash: "a".repeat(64), artifact_ref: "run:run-dev-1@2", diff_summary: "showcase", tests: ["npm test"], risks: [], approvals: [{ approver: "owner", approved_at: now, review_ref: "review://packet-1" }], prod_run_id: null, full_verification_ref: "verify://packet-1", release_acceptance_ref: null, rollback_ref: null, status: "approved", created_at: now, updated_at: now };
const openIncident: AutopilotIncident = {
  incident_id: "incident-open-1",
  recorded_at: "2026-07-21T09:55:00.000Z",
  status: "open",
  acknowledged_at: null,
  acknowledged_by: null,
  severity: "high",
  stage: "dispatch",
  summary: "Dispatch providera opakovaně selhal",
  correlation_ids: { run_id: "run-1" },
  impact: "Běh nebyl spuštěn",
  retry_count: 2,
  event_refs: ["event-1"],
};

async function mount(client: ControlPlaneClient) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(<AuthenticatedCockpit client={client} />); });
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}

function budgetPane(host: HTMLElement): HTMLElement { return [...host.querySelectorAll(".resources-section")].find((section) => section.querySelector("h3")?.textContent?.includes("Provideři")) as HTMLElement; }
function providerTab(scope: HTMLElement, id: string): HTMLButtonElement { return [...scope.querySelectorAll(".provider-tabs button")].find((item) => item.textContent === id) as HTMLButtonElement; }
function activeProvider(scope: HTMLElement): string | undefined { return scope.querySelector(".provider-heading h3")?.textContent ?? undefined; }
function changeInput(element: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function changeSelect(element: HTMLSelectElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("AuthenticatedCockpit provider budget", () => {
  it("exposes an explicit logout action", async () => {
    const onLogout = vi.fn().mockResolvedValue(undefined);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<AuthenticatedCockpit client={fakeClient()} onLogout={onLogout} />); });
    await act(async () => { await Promise.resolve(); });

    const logout = [...host.querySelectorAll("button")].find((button) => button.textContent === "Odhlásit") as HTMLButtonElement;
    expect(logout).toBeDefined();
    await act(async () => logout.click());
    expect(onLogout).toHaveBeenCalledOnce();
    act(() => root.unmount()); host.remove();
  });

  it("switches the viewed provider budget when a provider tab is clicked", async () => {
    const { host, root } = await mount(fakeClient());
    const pane = budgetPane(host);
    // the default selection skips providers without usable data (agy_cli has no quota snapshot here)
    expect(activeProvider(pane)).toBe("claude_cli");
    act(() => providerTab(pane, "codex_cli").click());
    expect(activeProvider(budgetPane(host))).toBe("codex_cli");
    act(() => root.unmount()); host.remove();
  });

  it("preserves the operator's chosen budget provider across a data refresh", async () => {
    const { host, root } = await mount(fakeClient());
    act(() => providerTab(budgetPane(host), "codex_cli").click());
    expect(activeProvider(budgetPane(host))).toBe("codex_cli");
    // A cockpit data refresh delivers fresh quota arrays (new identities). The
    // operator's budget selection lives in App state and must not silently reset
    // to the first provider when the data reloads.
    await act(async () => { root.render(<AuthenticatedCockpit client={fakeClient()} />); });
    await act(async () => { await Promise.resolve(); });
    expect(activeProvider(budgetPane(host))).toBe("codex_cli");
    act(() => root.unmount()); host.remove();
  });
});

describe("AuthenticatedCockpit session creation wiring", () => {
  it("passes the provider selected in the sessions pane to createSession", async () => {
    const createSession = vi.fn().mockResolvedValue(undefined);
    const source = fakeClient({ createSession });
    const { host, root } = await mount(source);
    const pane = host.querySelector<HTMLElement>(".session-pane")!;
    changeSelect(pane.querySelector<HTMLSelectElement>("#session-provider")!, "openrouter_api");
    changeInput(pane.querySelector<HTMLInputElement>("#session-cwd")!, "/work/openrouter");

    await act(async () => {
      pane.querySelector<HTMLFormElement>(".session-create")?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createSession).toHaveBeenCalledWith({ agent_command: "openrouter_api", cwd: "/work/openrouter" });
    act(() => root.unmount()); host.remove();
  });
});

describe("AuthenticatedCockpit incident diagnostics wiring", () => {
  it("opens the resources diagnostics panel from the command alert", async () => {
    window.history.replaceState(null, "", "/?environment=dev");
    const { host, root } = await mount(fakeClient({ getIncidents: vi.fn().mockResolvedValue([openIncident]) }));

    const alert = host.querySelector(".incident-alert-strip");
    expect(alert?.textContent).toContain("Dispatch providera opakovaně selhal");
    const openDiagnostics = [...alert!.querySelectorAll("button")].find((item) => item.textContent === "Otevřít diagnostiku") as HTMLButtonElement;
    act(() => openDiagnostics.click());

    const resourcesTab = host.querySelector('[data-cockpit-view="resources"]');
    const resourcesPanel = host.querySelector<HTMLElement>('[id$="-view-panel-resources"]');
    expect(resourcesTab?.getAttribute("aria-selected")).toBe("true");
    expect(resourcesPanel?.hasAttribute("hidden")).toBe(false);
    const diagnosticsSection = [...resourcesPanel!.querySelectorAll(".resources-section")]
      .find((section) => section.querySelector("h3")?.textContent === "Diagnostika nástroje");
    expect(diagnosticsSection?.textContent).toContain("Dispatch providera opakovaně selhal");

    act(() => root.unmount());
    host.remove();
    window.history.replaceState(null, "", "/");
  });
});

describe("AuthenticatedCockpit pending-run action wiring", () => {
  it("approves and cancels the exact run and refreshes after each mutation", async () => {
    window.history.replaceState(null, "", "/?environment=dev");
    const listRuns = vi.fn().mockResolvedValue([pendingDraftRun]);
    const approveRun = vi.fn().mockResolvedValue(pendingDraftRun);
    const cancelRun = vi.fn().mockResolvedValue({ ...pendingDraftRun, status: "cancelled" });
    const source = fakeClient({ listRuns, approveRun, cancelRun });
    const { host, root } = await mount(source);

    const approve = [...host.querySelectorAll("button")].find((item) => item.textContent === "Schválit") as HTMLButtonElement;
    act(() => approve.click());
    expect(approveRun).not.toHaveBeenCalled();
    const confirmApprove = [...host.querySelectorAll("button")].find((item) => item.textContent === "Potvrdit schválení") as HTMLButtonElement;
    await act(async () => {
      confirmApprove.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(approveRun).toHaveBeenCalledWith("run-draft-1", 4, "cockpit-operator");
    expect(listRuns).toHaveBeenCalledTimes(2);

    const cancel = [...host.querySelectorAll("button")].find((item) => item.textContent === "Zrušit") as HTMLButtonElement;
    act(() => cancel.click());
    const confirm = [...host.querySelectorAll("button")].find((item) => item.textContent === "Potvrdit zrušení") as HTMLButtonElement;
    await act(async () => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cancelRun).toHaveBeenCalledWith("run-draft-1");
    expect(listRuns).toHaveBeenCalledTimes(3);

    act(() => root.unmount());
    host.remove();
    window.history.replaceState(null, "", "/");
  });
});

describe("AuthenticatedCockpit promotion wiring", () => {
  it("prepares only a linked PROD draft from owner-approved verified evidence", async () => {
    window.history.replaceState(null, "", "/?environment=prod");
    const prodDraft = { ...completedDevRun, current: { ...completedDevRun.current, run_id: "run-prod-1", revision: 1, profile: "prod" as const, promotion_packet_id: "packet-1" }, status: "draft" as const, worker_run_id: null };
    const source = fakeClient({ listRuns: vi.fn().mockResolvedValue([]), listPromotions: vi.fn().mockResolvedValue([verifiedPacket]), getRun: vi.fn().mockResolvedValue(completedDevRun), createProdDraft: vi.fn().mockResolvedValue(prodDraft), approveRun: vi.fn(), markPromotionPublished: vi.fn() });
    const { host, root } = await mount(source);
    const prepare = [...host.querySelectorAll("button")].find((item) => item.textContent === "Připravit PROD draft") as HTMLButtonElement;
    expect(prepare).toBeDefined();
    await act(async () => prepare.click());
    expect(source.createProdDraft).toHaveBeenCalledWith("packet-1", "verify://packet-1", expect.objectContaining({ provider: "codex_cli", model: "gpt-5", requested_reasoning_effort: "high" }));
    expect(source.approveRun).not.toHaveBeenCalled();
    expect(source.markPromotionPublished).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove(); window.history.replaceState(null, "", "/");
  });
});
