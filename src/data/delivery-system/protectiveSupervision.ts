export type ProtectiveSupervisionLane =
  | "currentness_sentinel"
  | "handoff_compiler"
  | "progress_ledger"
  | "blocker_review"
  | "failure_repair_supervision";

export type ProjectProgressState =
  | "not_started"
  | "ready"
  | "in_progress"
  | "needs_review"
  | "blocked"
  | "waiting_owner"
  | "waiting_external"
  | "done"
  | "cancelled";

export interface ProtectiveSupervisionPolicy {
  readonly agentId: "protective-supervisor";
  readonly sourceOfTruth: "decision_mesh_and_project_work_logs";
  readonly mode: "read_only_guardrail_until_owner_approval";
  readonly recurringCadence: "weekly_review_default";
  readonly lanes: readonly ProtectiveSupervisionLane[];
  readonly progressStates: readonly ProjectProgressState[];
  readonly requiredInputs: readonly string[];
  readonly requiredOutputs: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface ProtectiveSupervisionRouteInput {
  readonly task: string;
}

export interface ProtectiveSupervisionRouteResult {
  readonly activateAgent: "protective-supervisor";
  readonly lanes: readonly ProtectiveSupervisionLane[];
  readonly progressStates: readonly ProjectProgressState[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly outputContract: readonly string[];
}

export const failureRepairSupervisionChecks = [
  "failure_reproduced_or_failure_pointer_recorded",
  "affected_process_identified",
  "progress_checkpoint_created_before_fix",
  "affected_process_stopped_or_drained_before_fix",
  "fix_applied_after_process_safe",
  "session_restarted_after_fix",
  "continuity_updated_and_work_resumed"
] as const;

export const failureRepairSupervisionStopConditions = [
  "affected_process_unknown",
  "fix_applied_to_running_process_without_stop_or_drain",
  "session_restart_missing_after_process_fix",
  "continuity_missing_after_restart"
] as const;

export const protectiveSupervisionPolicy = {
  agentId: "protective-supervisor",
  sourceOfTruth: "decision_mesh_and_project_work_logs",
  mode: "read_only_guardrail_until_owner_approval",
  recurringCadence: "weekly_review_default",
  lanes: [
    "currentness_sentinel",
    "handoff_compiler",
    "progress_ledger",
    "blocker_review",
    "failure_repair_supervision"
  ],
  progressStates: [
    "not_started",
    "ready",
    "in_progress",
    "needs_review",
    "blocked",
    "waiting_owner",
    "waiting_external",
    "done",
    "cancelled"
  ],
  requiredInputs: [
    "project_slug_or_control_plane",
    "active_scope",
    "agent_output_or_source_pointer",
    "current_decision_mesh_packet",
    "work_log_or_progress_ledger",
    "verification_evidence",
    "next_agent_candidate"
  ],
  requiredOutputs: [
    "currentness_report",
    "normalized_handoff_packet",
    "progress_state_delta",
    "blocker_and_waiting_state_summary",
    "next_action_sequence",
    "source_pointers",
    "verification_gap_list"
  ],
  requiredChecks: [
    "project_scope_classified",
    "official_docs_or_context7_for_currentness",
    "source_pointer_recorded",
    "redacted_context_only",
    "agent_output_normalized",
    "next_agent_scope_declared",
    "progress_state_updated",
    "blocker_owner_declared",
    "waiting_dependency_declared",
    "no_raw_project_log_storage",
    "no_remote_mutation_without_approval"
  ],
  stopConditions: [
    "currentness_claim_without_source",
    "raw_agent_output_used_as_next_prompt",
    "missing_next_agent_scope",
    "stale_progress_ledger",
    "blocker_without_owner",
    "waiting_state_without_dependency",
    "duplicate_runtime_queue",
    "remote_mutation_without_approval",
    "paid_or_cloud_required_for_guardrail",
    "raw_project_logs_copied_to_autopilot"
  ]
} as const satisfies ProtectiveSupervisionPolicy;

export function selectProtectiveSupervisionRoute(
  input: ProtectiveSupervisionRouteInput
): ProtectiveSupervisionRouteResult {
  const normalizedTask = normalize(input.task);
  const lanes = selectLanes(normalizedTask);

  return {
    activateAgent: "protective-supervisor",
    lanes,
    progressStates: protectiveSupervisionPolicy.progressStates,
    requiredChecks: unique([
      ...protectiveSupervisionPolicy.requiredChecks,
      ...(lanes.includes("failure_repair_supervision") ? failureRepairSupervisionChecks : [])
    ]),
    stopConditions: unique([
      ...protectiveSupervisionPolicy.stopConditions,
      ...(lanes.includes("failure_repair_supervision") ? failureRepairSupervisionStopConditions : [])
    ]),
    outputContract: protectiveSupervisionPolicy.requiredOutputs
  };
}

function selectLanes(normalizedTask: string): ProtectiveSupervisionLane[] {
  const lanes: ProtectiveSupervisionLane[] = [];

  if (hasAny(normalizedTask, ["current", "latest", "updates", "official docs", "context7", "currentness"])) {
    lanes.push("currentness_sentinel");
  }

  if (hasAny(normalizedTask, ["agent output", "handoff", "next agent", "packet", "next input", "worker output"])) {
    lanes.push("handoff_compiler");
  }

  if (hasAny(normalizedTask, ["progress", "done", "missing", "waiting", "depends", "dependency", "next steps"])) {
    lanes.push("progress_ledger");
  }

  if (hasAny(normalizedTask, ["blocker", "blocked", "waiting owner", "stop condition", "risk"])) {
    lanes.push("blocker_review");
  }

  if (
    hasAny(normalizedTask, [
      "failed",
      "failure",
      "broken",
      "not working",
      "investigate",
      "diagnostic",
      "process",
      "running",
      "restart",
      "session",
      "resume"
    ])
  ) {
    lanes.push("failure_repair_supervision");
  }

  return unique(lanes.length > 0 ? lanes : ["progress_ledger"]);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function hasAny(normalizedTask: string, terms: readonly string[]): boolean {
  return terms.some((term) => normalizedTask.includes(normalize(term)));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
