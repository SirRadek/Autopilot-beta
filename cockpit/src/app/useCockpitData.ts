import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlPlaneClient } from "../api/controlPlaneClient";
import type { ApprovalRecord, AutopilotIncident, ControlPlaneStatus, ObservabilityTimeline, ProjectEntry, ProviderHealth, ProviderModels, ProviderQuota, RunRecord, SessionRecord, WorkerRecord } from "../types/controlPlane";

export type CockpitPane = "status" | "sessions" | "approvals" | "providers" | "workers" | "runs" | "incidents" | "timeline";
export type PaneError = { readonly message: string; readonly at: string };
export type CockpitData = { readonly status?: ControlPlaneStatus; readonly sessions: readonly SessionRecord[]; readonly approvals: readonly ApprovalRecord[]; readonly quotas: readonly ProviderQuota[]; readonly workers: readonly WorkerRecord[]; readonly projects: readonly ProjectEntry[]; readonly runs: readonly RunRecord[]; readonly incidents: readonly AutopilotIncident[]; readonly timeline?: ObservabilityTimeline; readonly models?: ProviderModels; readonly health?: ProviderHealth };
export type CockpitDataState = CockpitData & { readonly loading: boolean; readonly refreshing: boolean; readonly errors: Partial<Record<CockpitPane, PaneError>>; readonly stale: Partial<Record<CockpitPane, boolean>>; readonly refreshedAt?: string; readonly refresh: () => Promise<void> };

const EMPTY_DATA: CockpitData = { sessions: [], approvals: [], quotas: [], workers: [], projects: [], runs: [], incidents: [] };
const DEFAULT_REFRESH_MS = 30_000; const MIN_REFRESH_MS = 5_000; const MAX_REFRESH_MS = 300_000;
function boundedRefreshMs(value: number | undefined): number { return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, value ?? DEFAULT_REFRESH_MS)); }
function messageFor(error: unknown): string { return error instanceof Error ? error.message.slice(0, 300) : "Control Plane request failed"; }

export async function loadCockpitData(client: ControlPlaneClient, previous: CockpitData, signal?: AbortSignal): Promise<{ readonly data: CockpitData; readonly errors: Partial<Record<CockpitPane, PaneError>> }> {
  const now = new Date().toISOString(); const errors: Partial<Record<CockpitPane, PaneError>> = {}; const next = { ...EMPTY_DATA, ...previous };
  const requests: Array<[CockpitPane, () => Promise<unknown>, (value: unknown) => void]> = [
    ["status", () => client.getStatus(), (value) => { next.status = value as ControlPlaneStatus; }],
    ["sessions", () => client.getSessions(), (value) => { next.sessions = value as readonly SessionRecord[]; }],
    ["approvals", () => client.getApprovals(), (value) => { next.approvals = value as readonly ApprovalRecord[]; }],
    ["workers", () => client.getWorkers(), (value) => { next.workers = value as readonly WorkerRecord[]; }],
    ["runs", () => Promise.all([client.getProjects(), client.getRuns()]), (value) => { const [projects, runs] = value as [readonly ProjectEntry[], readonly RunRecord[]]; next.projects = projects; next.runs = runs; }],
    ["incidents", () => client.getIncidents(), (value) => { next.incidents = value as readonly AutopilotIncident[]; }],
    ["timeline", () => client.getObservabilityTimeline({ limit: 100 }), (value) => { next.timeline = value as ObservabilityTimeline; }],
  ];
  await Promise.all(requests.map(async ([pane, request, assign]) => { try { const value = await request(); if (!signal?.aborted) assign(value); } catch (error) { if (!signal?.aborted) errors[pane] = { message: messageFor(error), at: now }; } }));
  const providerResults = await Promise.allSettled([client.getProviderQuotas(), client.getProviderModels(), client.getProviderHealth()]);
  if (!signal?.aborted) { const [quotas, models, health] = providerResults; if (quotas.status === "fulfilled") next.quotas = quotas.value.providers; if (models.status === "fulfilled") next.models = models.value; if (health.status === "fulfilled") next.health = health.value; const failed = providerResults.filter((result) => result.status === "rejected"); if (failed.length) errors.providers = { message: failed.map((result) => messageFor(result.reason)).join("; ").slice(0, 300), at: now }; }
  return { data: next, errors };
}

export function useCockpitData(client: ControlPlaneClient, options: { readonly refreshMs?: number } = {}): CockpitDataState {
  const refreshMs = boundedRefreshMs(options.refreshMs); const previous = useRef<CockpitData>(EMPTY_DATA); const generation = useRef(0); const controller = useRef<AbortController>(); const [data, setData] = useState<CockpitData>(previous.current); const [errors, setErrors] = useState<Partial<Record<CockpitPane, PaneError>>>({}); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [refreshedAt, setRefreshedAt] = useState<string>();
  const refresh = useCallback(async () => { const current = ++generation.current; controller.current?.abort(); const nextController = new AbortController(); controller.current = nextController; setRefreshing(true); const result = await loadCockpitData(client, previous.current, nextController.signal); if (nextController.signal.aborted || current !== generation.current) return; previous.current = result.data; setData(result.data); setErrors(result.errors); setLoading(false); setRefreshing(false); setRefreshedAt(new Date().toISOString()); }, [client]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), refreshMs); return () => { generation.current += 1; controller.current?.abort(); window.clearInterval(timer); }; }, [refresh, refreshMs]);
  const stale = Object.fromEntries(Object.keys(errors).map((pane) => [pane, true])) as Partial<Record<CockpitPane, boolean>>; return { ...data, loading, refreshing, errors, stale, refreshedAt, refresh };
}
