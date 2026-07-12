import type { ApprovalRecord, ControlPlaneStatus, ObservabilitySummary, ObservabilityTimeline, ProviderHealth, ProviderModels, ProviderQuota, SessionRecord, WorkerRecord } from "../types/controlPlane";

export class ControlPlaneApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ControlPlaneApiError"; }
}

export interface ControlPlaneClientOptions { readonly baseUrl?: string; readonly token?: string; readonly fetcher?: typeof fetch }
export interface BrowserAuthSession { readonly authenticated: boolean; readonly expires_at?: string }
export interface ControlPlaneClient {
  getAuthSession(): Promise<BrowserAuthSession>;
  login(token: string): Promise<BrowserAuthSession>;
  logout(): Promise<void>;
  getStatus(): Promise<ControlPlaneStatus>;
  getSessions(): Promise<readonly SessionRecord[]>;
  getApprovals(): Promise<readonly ApprovalRecord[]>;
  getWorkers(): Promise<readonly WorkerRecord[]>;
  getObservabilitySummary(): Promise<ObservabilitySummary>;
  getObservabilityTimeline(filters?: { readonly session_id?: string; readonly handoff_id?: string; readonly worker_run_id?: string; readonly provider?: string; readonly model?: string; readonly limit?: number }): Promise<ObservabilityTimeline>;
  createSession(input: { readonly agent_command: string; readonly cwd: string; readonly name?: string }): Promise<SessionRecord>;
  mutateSession(id: string, action: "resume" | "close"): Promise<SessionRecord>;
  getProviderQuotas(): Promise<{ readonly providers: readonly ProviderQuota[] }>;
  getProviderModels(): Promise<ProviderModels>;
  getProviderHealth(): Promise<ProviderHealth>;
  decideApproval(id: string, decision: "approved" | "rejected", reason?: string): Promise<ApprovalRecord>;
}

export function createControlPlaneClient(options: ControlPlaneClientOptions = {}): ControlPlaneClient {
  // Browser builds use same-origin requests. Vite's development proxy (and a
  // production reverse proxy) forwards these paths to the loopback Control
  // Plane, so no long-lived credential is embedded in the asset bundle.
  const baseUrl = (options.baseUrl ?? import.meta.env?.VITE_CONTROL_PLANE_URL ?? "").replace(/\/$/, "");
  const token = options.token ?? "";
  const fetcher = options.fetcher ?? fetch;
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetcher(`${baseUrl}${path}`, { ...init, headers, credentials: "include" });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new ControlPlaneApiError(response.status, body || `control_plane_http_${response.status}`);
    }
    return await response.json() as T;
  }
  return {
    getAuthSession: () => request<BrowserAuthSession>("/auth/session"),
    login: (loginToken) => request<BrowserAuthSession>("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: loginToken }) }),
    logout: async () => { await request<BrowserAuthSession>("/auth/logout", { method: "POST" }); },
    getStatus: () => request<ControlPlaneStatus>("/status"),
    getSessions: () => request<readonly SessionRecord[]>("/sessions"),
    getApprovals: () => request<readonly ApprovalRecord[]>("/approvals"),
    getWorkers: () => request<readonly WorkerRecord[]>("/workers"),
    getObservabilitySummary: () => request<ObservabilitySummary>("/observability/summary"),
    getObservabilityTimeline: (filters = {}) => {
      const query = new URLSearchParams();
      for (const key of ["session_id", "handoff_id", "worker_run_id", "provider", "model"] as const) if (filters[key] !== undefined) query.set(key, filters[key]);
      if (filters.limit !== undefined) query.set("limit", String(filters.limit));
      const suffix = query.size === 0 ? "" : `?${query.toString()}`;
      return request<ObservabilityTimeline>(`/observability/timeline${suffix}`);
    },
    createSession: (input) => request<SessionRecord>("/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
    mutateSession: (id, action) => request<SessionRecord>(`/sessions/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }),
    getProviderQuotas: () => request<{ readonly providers: readonly ProviderQuota[] }>("/providers/quotas"),
    getProviderModels: () => request<ProviderModels>("/providers/models"),
    getProviderHealth: () => request<ProviderHealth>("/providers/health"),
    decideApproval: (id, decision, reason) => request<ApprovalRecord>(`/approvals/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, ...(reason === undefined ? {} : { reason }) }) })
  };
}
