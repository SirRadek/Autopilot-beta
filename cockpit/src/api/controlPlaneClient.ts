import type { ApprovalRecord, AutopilotIncident, AutopilotRepairPacket, BrainstormArbitrationInput, BrainstormDraftInput, BrainstormRecord, ControlPlaneStatus, ObservabilitySummary, ObservabilityTimeline, ProjectCreateInput, ProjectEntry, PromotionApproval, PromotionDraftInput, PromotionPacket, PromotionPublishEvidence, ProviderHealth, ProviderModels, ProviderQuota, ReadinessReport, RepairPacketInput, RunDraftBody, RunDraftInput, RunProfile, RunRecord, RunStatus, SessionRecord, WorkerRecord, FigmaMutationRecord } from "../types/controlPlane";

export const NON_JSON_RESPONSE = "control_plane_non_json_response";

export class ControlPlaneApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ControlPlaneApiError"; }
}

export interface ControlPlaneClientOptions {
  readonly baseUrl?: string;
  /** Service/test-only bearer seam; browser operators authenticate with login(). */
  readonly serviceToken?: string;
  readonly fetcher?: typeof fetch;
}
export interface BrowserAuthSession { readonly authenticated: boolean; readonly expires_at?: string }
export interface AdminLoginCredentials { readonly username: string; readonly password: string }
export interface ControlPlaneClient {
  getAuthSession(): Promise<BrowserAuthSession>;
  login(credentials: AdminLoginCredentials): Promise<BrowserAuthSession>;
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
  getReadiness(): Promise<ReadinessReport | null>;
  decideApproval(id: string, decision: "approved" | "rejected", reason?: string): Promise<ApprovalRecord>;
  getProjects(): Promise<readonly ProjectEntry[]>;
  createProject(input: ProjectCreateInput): Promise<ProjectEntry>;
  getRuns(status?: RunStatus): Promise<readonly RunRecord[]>;
  listRuns(profile: RunProfile): Promise<readonly RunRecord[]>;
  getRun(id: string): Promise<RunRecord>;
  /** @deprecated Use createDevRun; this compatibility alias is DEV-only. */
  prepareRun(input: RunDraftBody): Promise<RunRecord>;
  createDevRun(body: RunDraftBody): Promise<RunRecord>;
  createProdDraft(packetId: string, verificationRef: string, body: RunDraftBody): Promise<RunRecord>;
  promoteRun(runId: string, body: PromotionDraftInput): Promise<PromotionPacket>;
  listPromotions(): Promise<readonly PromotionPacket[]>;
  approvePromotion(packetId: string, body: Pick<PromotionApproval, "approver" | "review_ref">): Promise<PromotionPacket>;
  rejectPromotion(packetId: string): Promise<PromotionPacket>;
  recordPromotionVerification(packetId: string, evidenceRef: string): Promise<PromotionPacket>;
  markPromotionPublished(packetId: string, evidence: PromotionPublishEvidence): Promise<PromotionPacket>;
  reviseRun(id: string, revision: number, input: RunDraftInput): Promise<RunRecord>;
  approveRun(id: string, revision: number, operator: string): Promise<RunRecord>;
  cancelRun(id: string): Promise<RunRecord>;
  getIncidents(): Promise<readonly AutopilotIncident[]>;
  acknowledgeIncident(id: string, owner: string): Promise<AutopilotIncident>;
  listFigmaMutations(): Promise<readonly FigmaMutationRecord[]>;
  decideFigmaMutation(id: string, decision: "approved" | "rejected", reason?: string): Promise<FigmaMutationRecord>;
  prepareRepairPacket(id: string, input: RepairPacketInput): Promise<AutopilotRepairPacket>;
  listBrainstorms(): Promise<readonly BrainstormRecord[]>;
  getBrainstorm(id: string): Promise<BrainstormRecord>;
  createBrainstorm(input: BrainstormDraftInput): Promise<BrainstormRecord>;
  approveBrainstorm(id: string, operator: string): Promise<BrainstormRecord>;
  arbitrateBrainstorm(id: string, operator: string, route: BrainstormArbitrationInput): Promise<BrainstormRecord>;
  cancelBrainstorm(id: string): Promise<BrainstormRecord>;
}

export function createControlPlaneClient(options: ControlPlaneClientOptions = {}): ControlPlaneClient {
  // Browser builds use same-origin requests. Vite's development proxy (and a
  // production reverse proxy) forwards these paths to the loopback Control
  // Plane, so no long-lived credential is embedded in the asset bundle.
  const baseUrl = (options.baseUrl ?? import.meta.env?.VITE_CONTROL_PLANE_URL ?? "").replace(/\/$/, "");
  const serviceToken = options.serviceToken ?? "";
  const fetcher = options.fetcher ?? fetch;
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (serviceToken) headers.set("Authorization", `Bearer ${serviceToken}`);
    const response = await fetcher(`${baseUrl}${path}`, { ...init, headers, credentials: "include" });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new ControlPlaneApiError(response.status, body || `control_plane_http_${response.status}`);
    }
    try {
      return await response.json() as T;
    } catch {
      throw new ControlPlaneApiError(response.status, NON_JSON_RESPONSE);
    }
  }
  return {
    getAuthSession: () => request<BrowserAuthSession>("/auth/session"),
    login: (credentials) => request<BrowserAuthSession>("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) }),
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
    getReadiness: async () => {
      try {
        const response = await fetcher(`${baseUrl}/ready`, { headers: { Accept: "application/json" }, credentials: "include" });
        if (response.status !== 200 && response.status !== 503) return null;
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return null;
        }
        if (
          typeof body !== "object"
          || body === null
          || !("ready" in body)
          || typeof body.ready !== "boolean"
          || !("components" in body)
          || typeof body.components !== "object"
          || body.components === null
          || !("providers" in body.components)
          || typeof body.components.providers !== "object"
          || body.components.providers === null
        ) return null;
        return body as ReadinessReport;
      } catch {
        return null;
      }
    },
    decideApproval: (id, decision, reason) => request<ApprovalRecord>(`/approvals/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, ...(reason === undefined ? {} : { reason }) }) }),
    getProjects: () => request<readonly ProjectEntry[]>("/projects"),
    createProject: (input) => request<ProjectEntry>("/projects", jsonPost(input)),
    getRuns: (status) => request<readonly RunRecord[]>(`/runs${status === undefined ? "" : `?status=${encodeURIComponent(status)}`}`),
    listRuns: (profile) => request<readonly RunRecord[]>(`/runs?profile=${encodeURIComponent(profile)}`),
    getRun: (id) => request<RunRecord>(`/runs/${encodeURIComponent(id)}`),
    prepareRun: (input) => request<RunRecord>("/runs", jsonPost({ ...input, profile: "dev", promotion_packet_id: null })),
    createDevRun: (body) => request<RunRecord>("/runs", jsonPost({ ...body, profile: "dev", promotion_packet_id: null })),
    createProdDraft: (packetId, verificationRef, body) => request<RunRecord>("/runs", jsonPost({ ...body, profile: "prod", promotion_packet_id: packetId, full_verification_ref: verificationRef })),
    promoteRun: (runId, body) => request<PromotionPacket>(`/runs/${encodeURIComponent(runId)}/promote`, jsonPost(body)),
    listPromotions: async () => (await request<{ readonly packets: readonly PromotionPacket[] }>("/promotions")).packets,
    approvePromotion: (packetId, body) => request<PromotionPacket>(`/promotions/${encodeURIComponent(packetId)}/approve`, jsonPost(body)),
    rejectPromotion: (packetId) => request<PromotionPacket>(`/promotions/${encodeURIComponent(packetId)}/reject`, jsonPost({})),
    recordPromotionVerification: (packetId, evidenceRef) => request<PromotionPacket>(`/promotions/${encodeURIComponent(packetId)}/record-verification`, jsonPost({ full_verification_ref: evidenceRef })),
    markPromotionPublished: (packetId, evidence) => request<PromotionPacket>(`/promotions/${encodeURIComponent(packetId)}/mark-published`, jsonPost(evidence)),
    reviseRun: (id, revision, input) => request<RunRecord>(`/runs/${encodeURIComponent(id)}/revisions`, jsonPost({ ...input, revision })),
    approveRun: (id, revision, operator) => request<RunRecord>(`/runs/${encodeURIComponent(id)}/approve`, jsonPost({ revision, operator })),
    cancelRun: (id) => request<RunRecord>(`/runs/${encodeURIComponent(id)}/cancel`, jsonPost({})),
    getIncidents: () => request<readonly AutopilotIncident[]>("/incidents"),
    acknowledgeIncident: (id, owner) => request<AutopilotIncident>(`/incidents/${encodeURIComponent(id)}/acknowledge`, jsonPost({ owner })),
    prepareRepairPacket: (id, input) => request<AutopilotRepairPacket>(`/incidents/${encodeURIComponent(id)}/repair-packet`, jsonPost(input)),
    listFigmaMutations: () => request<readonly FigmaMutationRecord[]>("/figma/mutations"),
    decideFigmaMutation: (id, decision, reason) => request<FigmaMutationRecord>(`/figma/mutations/${encodeURIComponent(id)}`, jsonPost({ decision, approver: "cockpit-operator", ...(reason ? { reason } : {}) })),
    listBrainstorms: () => request<readonly BrainstormRecord[]>("/brainstorms"),
    getBrainstorm: (id) => request<BrainstormRecord>(`/brainstorms/${encodeURIComponent(id)}`),
    createBrainstorm: (input) => request<BrainstormRecord>("/brainstorms", jsonPost(input)),
    approveBrainstorm: (id, operator) => request<BrainstormRecord>(`/brainstorms/${encodeURIComponent(id)}/approve`, jsonPost({ operator })),
    arbitrateBrainstorm: (id, operator, route) => request<BrainstormRecord>(`/brainstorms/${encodeURIComponent(id)}/arbitrate`, jsonPost({ operator, route })),
    cancelBrainstorm: (id) => request<BrainstormRecord>(`/brainstorms/${encodeURIComponent(id)}/cancel`, jsonPost({}))
  };
}

function jsonPost(body: unknown): RequestInit { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
