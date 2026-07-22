export interface ControlPlaneStatus {
  readonly sessions: { readonly total: number; readonly active: number; readonly closed: number };
  readonly approvals: { readonly total: number; readonly pending: number; readonly approved: number; readonly rejected: number };
  readonly telemetry: { readonly calls: number; readonly successful: number; readonly total_tokens: number };
}

export interface SessionRecord { readonly session_id: string; readonly agent_command: string; readonly cwd: string; readonly name: string | null; readonly status: "active" | "closed"; readonly created_at: string; readonly updated_at: string; readonly owner_expires_at: string | null; readonly queue: readonly { readonly prompt_id: string; readonly queued_at: string }[]; readonly close_reason?: string }
export interface ApprovalRecord { readonly schema_version: "v1"; readonly approval_id: string; readonly session_id: string; readonly vendor: string; readonly model: string | null; readonly skill_ids: readonly string[]; readonly prompt_preview: string; readonly prompt_file: string | null; readonly input_token_bound: number; readonly output_token_allowance: number; readonly estimated_tokens: number; readonly status: "pending" | "approved" | "rejected"; readonly created_at: string; readonly decided_at: string | null; readonly rejection_reason: string | null }
export interface ProviderQuotaWindow { readonly limit: number | null; readonly used: number | null; readonly remaining: number | null; readonly resets_at: string | null }
export interface ProviderModel { readonly model_id: string; readonly available: boolean; readonly health: string; readonly source: string; readonly fetched_at?: string | null; readonly updated_at?: string | null }
export interface ProviderQuota { readonly provider: string; readonly source: string; readonly fetched_at: string; readonly observed_at: string; readonly five_hour: ProviderQuotaWindow; readonly weekly: ProviderQuotaWindow; readonly api_spend: number | null; readonly currency: string | null; readonly models: readonly ProviderModel[]; readonly health: string; readonly error_code: string | null; readonly freshness: "fresh" | "stale" | "unavailable"; readonly next_poll_at: string | null }
export type RunReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export interface ProviderModelRoute { readonly provider: string; readonly reasoning_efforts: readonly RunReasoningEffort[] }
export interface ProviderModels { readonly freshness: string; readonly fetched_at: string | null; readonly next_poll_at: string | null; readonly models: readonly { readonly model_id: string; readonly providers: readonly string[]; readonly available: boolean; readonly health: readonly string[]; readonly reasoning_efforts: readonly RunReasoningEffort[]; readonly provider_routes?: readonly ProviderModelRoute[]; readonly fetched_at?: string | null; readonly updated_at?: string | null }[] }
export interface ProviderHealth { readonly providers: readonly { readonly provider: string; readonly health: string; readonly freshness: string; readonly fetched_at: string; readonly next_poll_at: string | null; readonly error_code: string | null }[] }
export interface WorkerRecord { readonly worker_run_id: string; readonly vendor: string; readonly model: string | null; readonly session_id: string; readonly status: "running" | "completed" | "blocked" | "error"; readonly started_at: string; readonly finished_at?: string | null; readonly output?: string | null; readonly error_reason?: string | null }
export interface ObservabilitySummary { readonly events: number; readonly tokens: number; readonly retries: number; readonly refusals: number; readonly openrouter_cost_usd: number; readonly waste_signals: readonly { readonly kind: "duplicate_dispatch" | "repeated_input_token_count"; readonly evidence_key: string; readonly occurrences: number }[] }
export interface ObservabilityEvent { readonly at: string; readonly source: "dispatch" | "cli_call" | "token_gateway" | "openrouter_spend" | "provider_quota" | "audit"; readonly event: string; readonly session_id: string | null; readonly handoff_id: string | null; readonly worker_run_id: string | null; readonly provider: string | null; readonly model: string | null; readonly tokens: number; readonly retries: number; readonly refused: boolean; readonly cost_usd: number; readonly detail: string | null }
export interface ObservabilityTimeline { readonly summary: ObservabilitySummary; readonly timeline: readonly ObservabilityEvent[]; readonly limits: { readonly files_scanned: number; readonly max_bytes_per_file: number; readonly max_lines_per_file: number; readonly max_events: number; readonly truncated: boolean } }
export interface ProjectEntry { readonly schema_version: "v1"; readonly project_id: string; readonly name: string; readonly cwd: string; readonly enabled: boolean }
export type RunStatus = "draft" | "approved" | "queued" | "running" | "completed" | "failed" | "cancelled";
export type RunProvider = "codex_cli" | "claude_cli" | "agy_cli" | "openrouter_api";
export type RunArtifactType = "text" | "visual";
export type RunProfile = "dev" | "prod";
export interface RunDraftBody { readonly project_id: string; readonly prompt: string; readonly provider: RunProvider; readonly model: string | null; readonly estimated_tokens: number; readonly requested_artifacts: readonly RunArtifactType[]; readonly prompt_review_acknowledged?: boolean; readonly requested_reasoning_effort?: RunReasoningEffort | null }
export interface RunDraftInput extends RunDraftBody { readonly profile?: RunProfile; readonly promotion_packet_id?: string | null }
export interface RunDraft extends RunDraftBody { readonly run_id: string; readonly revision: number; readonly input_token_bound: number; readonly output_token_allowance: number; readonly profile: RunProfile; readonly requested_reasoning_effort: RunReasoningEffort | null; readonly promotion_packet_id: string | null; readonly created_at: string }
export interface RunReservation { readonly reservationId: string; readonly provider: string; readonly model: string | null; readonly sessionId: string | null; readonly inputTokens: number; readonly outputTokens: number; readonly handoffId?: string; readonly reservedAt: string; readonly totalTokens: number }
export interface RunProviderResult { readonly refused: boolean; readonly reason: string | null; readonly worker_run_id: string | null; readonly raw_output: string; readonly exit_code: number | null; readonly error_reason: string | null; readonly lock_status: "acquired_supervisor_spawn" | "already_locked" | "stale_replaced" | "failed" | null }
export interface RunRecord { readonly schema_version: "v1"; readonly current: RunDraft; readonly revisions: readonly RunDraft[]; readonly status: RunStatus; readonly approved_revision: number | null; readonly approved_by: string | null; readonly approved_at: string | null; readonly supervisor_task_id: string | null; readonly worker_run_id: string | null; readonly terminal_reason: string | null; readonly token_reservation: RunReservation | null; readonly reservation_status: "none" | "active" | "settled" | "released"; readonly provider_result: RunProviderResult | null; readonly cancellation_requested: boolean; readonly queue_compensation_requested: boolean; readonly dispatch_failure: string | null; readonly retry_input_tokens: number; readonly retry_output_tokens: number; readonly artifacts: readonly { readonly artifact_id: string; readonly type: RunArtifactType; readonly preview: string; readonly created_at: string }[]; readonly updated_at: string }
export interface AutopilotIncident { readonly incident_id: string; readonly recorded_at: string; readonly status: "open" | "acknowledged"; readonly acknowledged_at: string | null; readonly acknowledged_by: string | null; readonly severity: "low" | "medium" | "high" | "critical"; readonly stage: string; readonly summary: string; readonly correlation_ids: Readonly<Record<string, string>>; readonly impact: string; readonly retry_count: number; readonly event_refs: readonly string[] }
export interface RepairPacketInput { readonly expected: string; readonly actual: string; readonly reproduction_steps?: readonly string[]; readonly verification_commands?: readonly string[] }
export interface AutopilotRepairPacket { readonly schema_version: "v1"; readonly intent: "external_autopilot_repair"; readonly execution: "manual"; readonly incident: AutopilotIncident; readonly expected: string; readonly actual: string; readonly reproduction_steps: readonly string[]; readonly verification_commands: readonly string[] }
export type PromotionStatus = "promotion_pending" | "approved" | "rejected" | "published" | "rolled_back";
export interface PromotionApproval { readonly approver: string; readonly approved_at: string; readonly review_ref: string }
export interface PromotionPublishEvidence { readonly prod_run_id: string; readonly full_verification_ref: string; readonly release_acceptance_ref: string; readonly rollback_ref: string }
export interface PromotionPacket { readonly schema_version: "v1"; readonly packet_id: string; readonly source_run_id: string; readonly source_revision: number; readonly intent: string; readonly artifact_hash: string; readonly artifact_ref: string; readonly diff_summary: string; readonly tests: readonly string[]; readonly risks: readonly string[]; readonly approvals: readonly PromotionApproval[]; readonly prod_run_id: string | null; readonly full_verification_ref: string | null; readonly release_acceptance_ref: string | null; readonly rollback_ref: string | null; readonly status: PromotionStatus; readonly created_at: string; readonly updated_at: string }
export interface PromotionDraftInput { readonly intent: string; readonly diff_summary: string; readonly tests: readonly string[]; readonly risks: readonly string[] }

export type BrainstormStatus = "draft" | "approved" | "fanout_running" | "consolidating" | "needs_arbitration" | "arbitrating" | "completed" | "failed" | "cancelled";
export type BrainstormStage = "fanout" | "consolidation" | "arbitration";
export interface BrainstormSlot { readonly slot_id: string; readonly stage: BrainstormStage; readonly route_index: number | null; readonly run_id: string | null; readonly state: "planned" | "created" | "queued" | "terminal" | "released" }
export interface BrainstormRoute { readonly provider: RunProvider; readonly model: string; readonly reasoning_effort: RunReasoningEffort | null; readonly estimated_tokens: number }
export interface BrainstormRouteDraft { readonly provider: RunProvider; readonly model: string; readonly requested_reasoning_effort: RunReasoningEffort | null }
export interface BrainstormTokenEnvelope { readonly fanout_tokens: number; readonly consolidation_tokens: number; readonly optional_arbitration_tokens: number; readonly minimum_tokens: number; readonly maximum_tokens: number }
export interface BrainstormConflict { readonly conflict_id: string; readonly output_run_ids: readonly [string, string]; readonly summary: string; readonly material: boolean }
export interface BrainstormRecord {
  readonly schema_version: "v1";
  readonly brainstorm_id: string;
  readonly project_id: string;
  readonly brief: string;
  readonly routes: readonly BrainstormRoute[];
  readonly synthesizer_route: BrainstormRoute;
  readonly arbitration_route: BrainstormRoute | null;
  readonly token_envelope: BrainstormTokenEnvelope;
  readonly child_run_ids: readonly string[];
  readonly consolidation_run_id: string | null;
  readonly arbitration_run_id: string | null;
  readonly conflicts: readonly BrainstormConflict[];
  readonly final_artifact: string | null;
  readonly status: BrainstormStatus;
  readonly revision: number;
  readonly approval_state: "none" | "pending" | "reserved";
  readonly orchestration_group_id: string | null;
  readonly slots: readonly BrainstormSlot[];
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
export interface BrainstormDraftInput { readonly project_id: string; readonly brief: string; readonly routes: readonly BrainstormRouteDraft[]; readonly synthesizer: RunProvider; readonly estimated_tokens: number }
export interface BrainstormArbitrationInput { readonly provider: RunProvider; readonly model: string; readonly reasoning_effort: RunReasoningEffort | null; readonly estimated_tokens: number }
