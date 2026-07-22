import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { ControlPlaneClient } from "../api/controlPlaneClient";
import type { PromotionPacket, ProviderQuota, RunRecord } from "../types/controlPlane";
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
    getProjects: vi.fn().mockResolvedValue([]), getRuns: vi.fn().mockResolvedValue([]), getRun: vi.fn(), prepareRun: vi.fn(), reviseRun: vi.fn(), approveRun: vi.fn(), cancelRun: vi.fn(),
    getIncidents: vi.fn().mockResolvedValue([]), acknowledgeIncident: vi.fn(), prepareRepairPacket: vi.fn(),
    listBrainstorms: vi.fn().mockResolvedValue([]), getBrainstorm: vi.fn(), createBrainstorm: vi.fn(), approveBrainstorm: vi.fn(), arbitrateBrainstorm: vi.fn(), cancelBrainstorm: vi.fn(),
    getObservabilitySummary: vi.fn().mockResolvedValue({ events: 0, tokens: 0, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }),
    getObservabilityTimeline: vi.fn().mockResolvedValue({ summary: { events: 0, tokens: 0, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }, timeline: [], limits: { files_scanned: 0, max_bytes_per_file: 0, max_lines_per_file: 0, max_events: 100, truncated: false } }),
    createSession: vi.fn(), mutateSession: vi.fn(),
    getProviderQuotas: vi.fn().mockResolvedValue({ providers: [providerQuota("claude_cli"), providerQuota("codex_cli")] }),
    getProviderModels: vi.fn().mockResolvedValue({ freshness: "fresh", fetched_at: now, next_poll_at: null, models: [] }),
    getProviderHealth: vi.fn().mockResolvedValue({ providers: [] }),
    decideApproval: vi.fn(), ...overrides,
  } as ControlPlaneClient;
}

const completedDevRun: RunRecord = {
  schema_version: "v1", current: { run_id: "run-dev-1", revision: 2, project_id: "autopilot-beta", prompt: "Publish showcase", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, input_token_bound: 200, output_token_allowance: 200, requested_artifacts: ["text"], prompt_review_acknowledged: true, profile: "dev", requested_reasoning_effort: "high", promotion_packet_id: null, created_at: now }, revisions: [], status: "completed", approved_revision: 2, approved_by: "owner", approved_at: now, supervisor_task_id: null, worker_run_id: "worker-1", terminal_reason: null, token_reservation: null, reservation_status: "settled", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: now,
};
const verifiedPacket: PromotionPacket = { schema_version: "v1", packet_id: "packet-1", source_run_id: "run-dev-1", source_revision: 2, intent: "Publish", artifact_hash: "a".repeat(64), artifact_ref: "run:run-dev-1@2", diff_summary: "showcase", tests: ["npm test"], risks: [], approvals: [{ approver: "owner", approved_at: now, review_ref: "review://packet-1" }], prod_run_id: null, full_verification_ref: "verify://packet-1", release_acceptance_ref: null, rollback_ref: null, status: "approved", created_at: now, updated_at: now };

async function mount(client: ControlPlaneClient) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(<AuthenticatedCockpit client={client} />); });
  await act(async () => { await Promise.resolve(); });
  return { host, root };
}

function budgetPane(host: HTMLElement): HTMLElement { return host.querySelector('[aria-label="Provider Budget"]') as HTMLElement; }
function providerTab(scope: HTMLElement, id: string): HTMLButtonElement { return [...scope.querySelectorAll(".provider-tabs button")].find((item) => item.textContent === id) as HTMLButtonElement; }
function activeProvider(scope: HTMLElement): string | undefined { return scope.querySelector(".provider-heading h3")?.textContent ?? undefined; }

describe("AuthenticatedCockpit provider budget", () => {
  it("switches the viewed provider budget when a provider tab is clicked", async () => {
    const { host, root } = await mount(fakeClient());
    const pane = budgetPane(host);
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
