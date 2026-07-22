import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ControlPlaneClient } from "../api/controlPlaneClient";
import { loadCockpitData, resolveCockpitDataRequest } from "./useCockpitData";
import { useCockpitData } from "./useCockpitData";
import { useRunTimeline } from "./useCockpitData";

const client = (overrides: Partial<ControlPlaneClient> = {}): ControlPlaneClient => ({
  getAuthSession: vi.fn().mockResolvedValue({ authenticated: true }), login: vi.fn(), logout: vi.fn(),
  getStatus: vi.fn().mockResolvedValue({ sessions: { total: 1, active: 1, closed: 0 }, approvals: { total: 0, pending: 0, approved: 0, rejected: 0 }, telemetry: { calls: 2, successful: 2, total_tokens: 10 } }),
  getSessions: vi.fn().mockResolvedValue([]), getApprovals: vi.fn().mockResolvedValue([]), getWorkers: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]), getRuns: vi.fn().mockResolvedValue([]), listRuns: vi.fn().mockResolvedValue([]), getRun: vi.fn(), prepareRun: vi.fn(), createDevRun: vi.fn(), createProdDraft: vi.fn(), promoteRun: vi.fn(), reviseRun: vi.fn(), approveRun: vi.fn(), cancelRun: vi.fn(),
  listPromotions: vi.fn().mockResolvedValue([]), approvePromotion: vi.fn(), rejectPromotion: vi.fn(), recordPromotionVerification: vi.fn(), markPromotionPublished: vi.fn(),
  getIncidents: vi.fn().mockResolvedValue([]), acknowledgeIncident: vi.fn(), prepareRepairPacket: vi.fn(),
  listBrainstorms: vi.fn().mockResolvedValue([]), getBrainstorm: vi.fn(), createBrainstorm: vi.fn(), approveBrainstorm: vi.fn(), arbitrateBrainstorm: vi.fn(), cancelBrainstorm: vi.fn(),
  getObservabilitySummary: vi.fn().mockResolvedValue({ events: 0, tokens: 0, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }), getObservabilityTimeline: vi.fn().mockResolvedValue({ summary: { events: 0, tokens: 0, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }, timeline: [], limits: { files_scanned: 0, max_bytes_per_file: 0, max_lines_per_file: 0, max_events: 100, truncated: false } }),
  createSession: vi.fn(), mutateSession: vi.fn(),
  getProviderQuotas: vi.fn().mockResolvedValue({ providers: [] }), getProviderModels: vi.fn().mockResolvedValue({ freshness: "fresh", fetched_at: null, next_poll_at: null, models: [] }), getProviderHealth: vi.fn().mockResolvedValue({ providers: [] }),
  decideApproval: vi.fn(), ...overrides,
});

describe("useCockpitData loader", () => {
  it("distinguishes the legacy options overload and rejects ambiguous keys", () => { expect(resolveCockpitDataRequest({ refreshMs: 5_000 })).toEqual({ environment: "dev", refreshMs: 5_000 }); expect(resolveCockpitDataRequest("prod", { refreshMs: 6_000 })).toEqual({ environment: "prod", refreshMs: 6_000 }); expect(() => resolveCockpitDataRequest({ environment: "prod" } as never)).toThrow("invalid_cockpit_data_options"); expect(() => resolveCockpitDataRequest("prod", { environment: "dev" } as never)).toThrow("invalid_cockpit_data_options"); });
  it("loads all panes independently", async () => { const result = await loadCockpitData(client(), { sessions: [], approvals: [], quotas: [], workers: [], projects: [], runs: [], incidents: [] }); expect(result.errors).toEqual({}); expect(result.data.status?.telemetry.total_tokens).toBe(10); });
  it("preserves the last safe pane snapshot on failure", async () => { const previous = { sessions: [{ session_id: "s1" } as never], approvals: [], quotas: [], workers: [], projects: [], runs: [], incidents: [] }; const result = await loadCockpitData(client({ getSessions: vi.fn().mockRejectedValue(new Error("offline")) }), previous); expect(result.data.sessions).toBe(previous.sessions); expect(result.errors.sessions?.message).toBe("offline"); });
  it("loads runs and promotions for the selected environment", async () => { const source = client(); await loadCockpitData(source, { sessions: [], approvals: [], quotas: [], workers: [], projects: [], runs: [], promotions: [], incidents: [] }, "prod"); expect(source.listRuns).toHaveBeenCalledWith("prod"); expect(source.listPromotions).toHaveBeenCalledOnce(); });
  it("refreshes a recovered pane without discarding other data", async () => { const result = await loadCockpitData(client({ getSessions: vi.fn().mockResolvedValue([{ session_id: "s2" }]) }), { sessions: [], approvals: [], quotas: [], workers: [], projects: [], runs: [], incidents: [] }); expect(result.data.sessions[0]?.session_id).toBe("s2"); });
});

describe("useCockpitData hook", () => {
  it("performs initial load, exposes refresh, and marks pane errors stale", async () => {
    const source = client({ getApprovals: vi.fn().mockRejectedValue(new Error("approval offline")) });
    const host = document.createElement("div"); document.body.append(host);
    let state: ReturnType<typeof useCockpitData> | undefined;
    function Harness() { state = useCockpitData(source, { refreshMs: 5_000 }); return null; }
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(Harness)); });
    expect(state?.status?.telemetry.total_tokens).toBe(10);
    expect(state?.errors.approvals?.message).toBe("approval offline");
    expect(state?.stale.approvals).toBe(true);
    const calls = (source.getStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { await state?.refresh(); });
    expect((source.getStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls);
    await act(async () => { root.unmount(); }); host.remove();
  });

  it("keeps successful provider sources when one source fails", async () => {
    const source = client({ getProviderModels: vi.fn().mockRejectedValue(new Error("models offline")), getProviderQuotas: vi.fn().mockResolvedValue({ providers: [{ provider: "codex", source: "cli", fetched_at: "now", observed_at: "now", five_hour: { limit: 1, used: 0, remaining: 1, resets_at: null }, weekly: { limit: 2, used: 0, remaining: 2, resets_at: null }, api_spend: null, currency: null, models: [], health: "ok", error_code: null, freshness: "fresh", next_poll_at: null }] }) });
    const result = await loadCockpitData(source, { sessions: [], approvals: [], quotas: [], workers: [], projects: [], runs: [], incidents: [] });
    expect(result.data.quotas).toHaveLength(1); expect(result.data.models).toBeUndefined(); expect(result.errors.providers?.message).toContain("models offline");
  });

  it("aborts superseded refreshes and ignores late results after unmount", async () => {
    let resolveStatus!: (value: unknown) => void;
    const source = client({ getStatus: vi.fn().mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; })) });
    const host = document.createElement("div"); document.body.append(host); let state: ReturnType<typeof useCockpitData> | undefined;
    function Harness() { state = useCockpitData(source, { refreshMs: 5_000 }); return null; }
    const root = createRoot(host); await act(async () => { root.render(React.createElement(Harness)); await Promise.resolve(); });
    await act(async () => { void state?.refresh(); await Promise.resolve(); });
    await act(async () => { root.unmount(); }); resolveStatus({ sessions: { total: 0, active: 0, closed: 0 }, approvals: { total: 0, pending: 0, approved: 0, rejected: 0 }, telemetry: { calls: 0, successful: 0, total_tokens: 0 } }); host.remove();
  });
});

describe("useRunTimeline", () => {
  it("requests the exact worker correlation and ignores a stale prior selection", async () => {
    let resolveFirst!: (value: never) => void; let resolveSecond!: (value: never) => void;
    const source = client({ getObservabilityTimeline: vi.fn().mockImplementation((filters) => new Promise((resolve) => { if (filters.worker_run_id === "worker-1") resolveFirst = resolve; else resolveSecond = resolve; })) });
    const first = { ...sourceTimeline(), summary: { ...sourceTimeline().summary, tokens: 11 } }; const second = { ...sourceTimeline(), summary: { ...sourceTimeline().summary, tokens: 22 } };
    const host = document.createElement("div"); document.body.append(host); let timeline: ReturnType<typeof useRunTimeline>;
    function Harness({ workerRunId }: { workerRunId?: string }) { timeline = useRunTimeline(source, workerRunId); return null; }
    const root = createRoot(host); await act(async () => { root.render(React.createElement(Harness, { workerRunId: "worker-1" })); await Promise.resolve(); }); await act(async () => { root.render(React.createElement(Harness, { workerRunId: "worker-2" })); await Promise.resolve(); });
    await act(async () => resolveSecond(second as never)); expect(timeline!.data?.summary.tokens).toBe(22); await act(async () => resolveFirst(first as never)); expect(timeline!.data?.summary.tokens).toBe(22);
    expect(source.getObservabilityTimeline).toHaveBeenNthCalledWith(1, { worker_run_id: "worker-1", limit: 100 }); expect(source.getObservabilityTimeline).toHaveBeenNthCalledWith(2, { worker_run_id: "worker-2", limit: 100 });
    act(() => root.unmount()); host.remove();
  });
});

function sourceTimeline() { return { summary: { events: 0, tokens: 0, retries: 0, refusals: 0, openrouter_cost_usd: 0, waste_signals: [] }, timeline: [], limits: { files_scanned: 0, max_bytes_per_file: 0, max_lines_per_file: 0, max_events: 100, truncated: false } }; }
