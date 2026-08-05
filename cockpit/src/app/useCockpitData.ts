import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlPlaneClient } from "../api/controlPlaneClient";
import type { ApprovalRecord, AutopilotIncident, BrainstormRecord, ControlPlaneStatus, ObservabilityTimeline, ProjectEntry, ProviderHealth, ProviderModels, ProviderQuota, ReadinessReport, RunRecord, SessionRecord, WorkerRecord } from "../types/controlPlane";
import type { PromotionPacket } from "../types/controlPlane";
import type { CockpitEnvironment } from "./environment";

export type CockpitPane = "status" | "sessions" | "approvals" | "providers" | "workers" | "runs" | "promotions" | "incidents" | "brainstorms";
export type PaneError = { readonly message: string; readonly at: string };
export type CockpitData = { readonly status?: ControlPlaneStatus; readonly sessions: readonly SessionRecord[]; readonly approvals: readonly ApprovalRecord[]; readonly quotas: readonly ProviderQuota[]; readonly workers: readonly WorkerRecord[]; readonly projects: readonly ProjectEntry[]; readonly runs: readonly RunRecord[]; readonly promotions: readonly PromotionPacket[]; readonly incidents: readonly AutopilotIncident[]; readonly brainstorms: readonly BrainstormRecord[]; readonly models?: ProviderModels; readonly health?: ProviderHealth; readonly readiness?: ReadinessReport | null };
export type CockpitDataState = CockpitData & { readonly loading: boolean; readonly refreshing: boolean; readonly errors: Partial<Record<CockpitPane, PaneError>>; readonly stale: Partial<Record<CockpitPane, boolean>>; readonly refreshedAt?: string; readonly refresh: () => Promise<void> };

const EMPTY_DATA: CockpitData = { sessions: [], approvals: [], quotas: [], workers: [], projects: [], runs: [], promotions: [], incidents: [], brainstorms: [] };
const DEFAULT_REFRESH_MS = 30_000; const MIN_REFRESH_MS = 5_000; const MAX_REFRESH_MS = 300_000;
function boundedRefreshMs(value: number | undefined): number { return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, value ?? DEFAULT_REFRESH_MS)); }
function messageFor(error: unknown): string { return error instanceof Error ? error.message.slice(0, 300) : "Control Plane request failed"; }
export type CockpitDataOptions = { readonly refreshMs?: number };
export function resolveCockpitDataRequest(environmentOrOptions: CockpitEnvironment | CockpitDataOptions = "dev", options: CockpitDataOptions = {}): { readonly environment: CockpitEnvironment; readonly refreshMs: number } {
  if (environmentOrOptions === "dev" || environmentOrOptions === "prod") { assertCockpitDataOptions(options); return { environment: environmentOrOptions, refreshMs: boundedRefreshMs(options.refreshMs) }; }
  assertCockpitDataOptions(environmentOrOptions);
  return { environment: "dev", refreshMs: boundedRefreshMs(environmentOrOptions.refreshMs) };
}
function assertCockpitDataOptions(value: unknown): asserts value is CockpitDataOptions {
  if (typeof value !== "object" || value === null || Object.keys(value).some((key) => key !== "refreshMs")) throw new Error("invalid_cockpit_data_options");
  const refreshMs = (value as CockpitDataOptions).refreshMs;
  if (refreshMs !== undefined && (!Number.isFinite(refreshMs) || refreshMs < 0)) throw new Error("invalid_cockpit_data_options");
}

export async function loadCockpitData(client: ControlPlaneClient, previous: CockpitData, environment: CockpitEnvironment = "dev", signal?: AbortSignal): Promise<{ readonly data: CockpitData; readonly errors: Partial<Record<CockpitPane, PaneError>> }> {
  const now = new Date().toISOString(); const errors: Partial<Record<CockpitPane, PaneError>> = {}; const next = { ...EMPTY_DATA, ...previous };
  const requests: Array<[CockpitPane, () => Promise<unknown>, (value: unknown) => void]> = [
    ["status", () => client.getStatus(), (value) => { next.status = value as ControlPlaneStatus; }],
    ["sessions", () => client.getSessions(), (value) => { next.sessions = value as readonly SessionRecord[]; }],
    ["approvals", () => client.getApprovals(), (value) => { next.approvals = value as readonly ApprovalRecord[]; }],
    ["workers", () => client.getWorkers(), (value) => { next.workers = value as readonly WorkerRecord[]; }],
    ["runs", () => Promise.all([client.getProjects(), client.listRuns(environment)]), (value) => { const [projects, runs] = value as [readonly ProjectEntry[], readonly RunRecord[]]; next.projects = projects; next.runs = runs; }],
    ["promotions", () => client.listPromotions(), (value) => { next.promotions = value as readonly PromotionPacket[]; }],
    ["incidents", () => client.getIncidents(), (value) => { next.incidents = value as readonly AutopilotIncident[]; }],
    ["brainstorms", () => client.listBrainstorms(), (value) => { next.brainstorms = value as readonly BrainstormRecord[]; }],
  ];
  await Promise.all(requests.map(async ([pane, request, assign]) => { try { const value = await request(); if (!signal?.aborted) assign(value); } catch (error) { if (!signal?.aborted) errors[pane] = { message: messageFor(error), at: now }; } }));
  const providerResults = await Promise.allSettled([client.getProviderQuotas(), client.getProviderModels(), client.getProviderHealth(), client.getReadiness()]);
  if (!signal?.aborted) { const [quotas, models, health, readiness] = providerResults; if (quotas.status === "fulfilled") next.quotas = quotas.value.providers; if (models.status === "fulfilled") next.models = models.value; if (health.status === "fulfilled") next.health = health.value; if (readiness.status === "fulfilled") next.readiness = readiness.value; const failed = [quotas, models, health].filter((result): result is PromiseRejectedResult => result.status === "rejected"); if (failed.length) errors.providers = { message: failed.map((result) => messageFor(result.reason)).join("; ").slice(0, 300), at: now }; }
  return { data: next, errors };
}

export type RunTimelineState = { readonly data?: ObservabilityTimeline; readonly loading: boolean; readonly error?: PaneError };

export function useRunTimeline(client: ControlPlaneClient, workerRunId: string | undefined): RunTimelineState {
  const generation = useRef(0); const controller = useRef<AbortController>(); const [state, setState] = useState<RunTimelineState>({ loading: false });
  useEffect(() => {
    const current = ++generation.current; controller.current?.abort(); const nextController = new AbortController(); controller.current = nextController;
    if (!workerRunId) { setState({ loading: false }); return () => nextController.abort(); }
    setState({ loading: true });
    void client.getObservabilityTimeline({ worker_run_id: workerRunId, limit: 100 }).then((data) => { if (!nextController.signal.aborted && current === generation.current) setState({ data, loading: false }); }).catch((error: unknown) => { if (!nextController.signal.aborted && current === generation.current) setState({ loading: false, error: { message: messageFor(error), at: new Date().toISOString() } }); });
    return () => nextController.abort();
  }, [client, workerRunId]);
  return state;
}

export function useCockpitData(client: ControlPlaneClient, environment?: CockpitEnvironment, options?: CockpitDataOptions): CockpitDataState;
export function useCockpitData(client: ControlPlaneClient, options?: CockpitDataOptions): CockpitDataState;
export function useCockpitData(client: ControlPlaneClient, environmentOrOptions: CockpitEnvironment | CockpitDataOptions = "dev", options: CockpitDataOptions = {}): CockpitDataState {
  const request = resolveCockpitDataRequest(environmentOrOptions, options); const environment = request.environment;
  const refreshMs = request.refreshMs; const previous = useRef<CockpitData>(EMPTY_DATA); const generation = useRef(0); const controller = useRef<AbortController>(); const [data, setData] = useState<CockpitData>(previous.current); const [dataEnvironment, setDataEnvironment] = useState<CockpitEnvironment>(environment); const [errors, setErrors] = useState<Partial<Record<CockpitPane, PaneError>>>({}); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [refreshedAt, setRefreshedAt] = useState<string>();
  const refresh = useCallback(async () => { const current = ++generation.current; controller.current?.abort(); const nextController = new AbortController(); controller.current = nextController; setRefreshing(true); const result = await loadCockpitData(client, previous.current, environment, nextController.signal); if (nextController.signal.aborted || current !== generation.current) return; previous.current = result.data; setData(result.data); setDataEnvironment(environment); setErrors(result.errors); setLoading(false); setRefreshing(false); setRefreshedAt(new Date().toISOString()); }, [client, environment]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), refreshMs); return () => { generation.current += 1; controller.current?.abort(); window.clearInterval(timer); }; }, [refresh, refreshMs]);
  const stale = Object.fromEntries(Object.keys(errors).map((pane) => [pane, true])) as Partial<Record<CockpitPane, boolean>>; const scoped = dataEnvironment === environment ? data : { ...data, runs: [], promotions: [], brainstorms: [] }; return { ...scoped, loading, refreshing, errors, stale, refreshedAt, refresh };
}
