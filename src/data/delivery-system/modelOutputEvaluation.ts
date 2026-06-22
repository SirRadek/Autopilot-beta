import type { HandoffId } from "./checkCompletionMatrix";

export type ModelOutputEvaluationPhase = "learning_immediate_loop" | "weekly_batch_tuning";

export type ModelOutputQualityState =
  | "needs_scoring"
  | "accepted"
  | "retry_with_prompt_or_input_tuning"
  | "review_model_or_reasoning_route"
  | "blocked";

export type ModelOutputScoreDimension =
  | "task_fit"
  | "instruction_following"
  | "source_grounding"
  | "format_contract"
  | "verification_readiness"
  | "privacy_safety"
  | "handoff_clarity"
  | "token_efficiency"
  | "workflow_compatibility";

export type ModelProviderFamily = "openai" | "anthropic" | "google" | "qwen" | "deepseek" | "local" | "unknown";

export type ModelProviderRunStatus = "not_run" | "succeeded" | "failed" | "unknown";

export type ModelOutputArtifactKind = "model_output" | "runner_log" | "prompt_only" | "mixed_log" | "unknown";

export const EVAL_RECORDS_PATH = "model-output-evals/records/";

export interface EvalRecordSummary {
  readonly taskType: string;
  readonly provider: ModelProviderFamily;
  readonly state: ModelOutputQualityState;
  readonly scoreAverage: number;
  readonly failureLabels: readonly string[];
  readonly rerunCount: number;
}

export interface SupervisorLearningSignal {
  readonly taskType: string;
  readonly provider: ModelProviderFamily;
  readonly recentFailureCount: number;
  readonly lastFailureLabels: readonly string[];
  readonly recommendedDelta: "tighten_allowed_files" | "decompose_task" | "switch_to_qwen" | "no_change";
  readonly confidenceSource: "eval_records" | "single_observation" | "no_data";
}

export interface CorrectionLoopEntry {
  readonly taskId: string;
  readonly handoffId: HandoffId;
  readonly provider: ModelProviderFamily;
  readonly iterationCount: number;
  readonly maxIterations: 3;
  readonly lastScore: number | undefined;
  readonly failureLabels: readonly string[];
  readonly correctionApplied: string;
  readonly state: ModelOutputQualityState;
}

export interface WorkerOutputNormalization {
  readonly handoffId: HandoffId;
  readonly verifiedFacts: readonly string[];
  readonly assumptions: readonly string[];
  readonly risks: readonly string[];
  readonly openQuestions: readonly string[];
  readonly evaluationScore: number;
  readonly qualityState: ModelOutputQualityState;
  readonly correctionLoopState: CorrectionLoopEntry;
  readonly nextAction: "accept" | "retry_with_correction" | "escalate_model_route" | "owner_decision" | "blocked";
}

export interface ModelOutputEvaluationPolicy {
  readonly sourceOfTruth: "local_eval_records_and_verified_outputs";
  readonly defaultPhase: ModelOutputEvaluationPhase;
  readonly weeklyCadence: "weekly_after_learning_baseline";
  readonly scoreScale: "0_to_100";
  readonly acceptanceThreshold: number;
  readonly retryThreshold: number;
  readonly repeatedFailureLimit: number;
  readonly dimensions: readonly ModelOutputScoreDimension[];
  readonly evaluationRecordFields: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly providerBestPracticeSources: Readonly<Record<ModelProviderFamily, readonly string[]>>;
}

export interface ModelOutputEvaluationRouteInput {
  readonly task: string;
  readonly score?: number | undefined;
  readonly repeatedFailures?: number | undefined;
  readonly provider?: ModelProviderFamily | undefined;
  readonly phase?: ModelOutputEvaluationPhase | undefined;
  readonly runnerStatus?: ModelProviderRunStatus | undefined;
  readonly artifactKind?: ModelOutputArtifactKind | undefined;
  readonly outputPresent?: boolean | undefined;
}

export interface ModelOutputEvaluationRouteResult {
  readonly phase: ModelOutputEvaluationPhase;
  readonly qualityState: ModelOutputQualityState;
  readonly dimensions: readonly ModelOutputScoreDimension[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly nextActions: readonly string[];
  readonly promptTuningActions: readonly string[];
  readonly escalationActions: readonly string[];
  readonly sourceIds: readonly string[];
}

export const modelOutputEvaluationPolicy = {
  sourceOfTruth: "local_eval_records_and_verified_outputs",
  defaultPhase: "learning_immediate_loop",
  weeklyCadence: "weekly_after_learning_baseline",
  scoreScale: "0_to_100",
  acceptanceThreshold: 80,
  retryThreshold: 60,
  repeatedFailureLimit: 3,
  dimensions: [
    "task_fit",
    "instruction_following",
    "source_grounding",
    "format_contract",
    "verification_readiness",
    "privacy_safety",
    "handoff_clarity",
    "token_efficiency",
    "workflow_compatibility"
  ],
  evaluationRecordFields: [
    "record_version",
    "eval_id",
    "created",
    "project",
    "task_type",
    "phase",
    "state",
    "model_or_worker",
    "reasoning_profile",
    "token_efficiency_profile",
    "provider_best_practice_sources",
    "input_packet_summary",
    "output_pointer",
    "score_by_dimension",
    "failure_labels",
    "prompt_or_input_delta",
    "rerun_count",
    "accepted_state",
    "verification_evidence",
    "source_pointers",
    "privacy_review",
    "route_review",
    "weekly_aggregate"
  ],
  requiredChecks: [
    "model_output_scored_before_acceptance",
    "score_dimensions_recorded",
    "runner_artifact_contract_verified",
    "provider_run_status_recorded",
    "model_output_presence_verified",
    "blocked_state_recorded_when_output_missing",
    "caveman_or_token_efficiency_route_selected",
    "provider_best_practice_sources_checked",
    "context7_or_official_docs_verified",
    "prompt_or_input_delta_recorded_before_rerun",
    "retry_loop_until_acceptable_or_blocked",
    "repeated_failure_triggers_model_or_reasoning_review",
    "weekly_tuning_uses_collected_eval_records",
    "workflow_handoff_clarity_checked",
    "plugin_or_skill_compatibility_checked",
    "privacy_redaction_checked",
    "source_pointers_recorded"
  ],
  stopConditions: [
    "output_accepted_without_score",
    "provider_run_failed_without_blocked_state",
    "model_output_missing_from_artifact",
    "advisory_workflow_continued_after_provider_error",
    "prompt_or_runner_log_treated_as_model_output",
    "score_dimensions_missing",
    "bad_output_retried_without_prompt_or_input_delta",
    "repeated_bad_output_without_model_or_reasoning_review",
    "provider_best_practice_claim_unverified",
    "context7_or_official_docs_missing_for_provider_claim",
    "weekly_tuning_without_eval_records",
    "raw_model_output_promoted_to_prompt_authority",
    "private_context_in_eval_record",
    "workflow_handoff_unclear_after_retry",
    "automation_runtime_added_without_architecture_decision"
  ],
  providerBestPracticeSources: {
    openai: ["openai-evals", "openai-model-optimization", "openai-prompt-engineering", "openai-structured-outputs"],
    anthropic: ["anthropic-evals", "anthropic-prompting-best-practices", "anthropic-tool-use"],
    google: ["gemini-api-prompting-strategies", "gemini-prompt-design-strategies", "gemini-long-context"],
    qwen: ["qwen-chat-template", "qwen-function-calling"],
    deepseek: ["deepseek-thinking-mode", "deepseek-json-output", "deepseek-function-calling"],
    local: ["local-agents-md", "token-efficiency-operating-model", "prompt-library-policy"],
    unknown: ["prompt-source-catalog", "prompt-library-policy"]
  }
} as const satisfies ModelOutputEvaluationPolicy;

export function selectModelOutputEvaluationRoute(
  input: ModelOutputEvaluationRouteInput
): ModelOutputEvaluationRouteResult {
  const normalizedTask = normalize(input.task);
  const phase = selectPhase(normalizedTask, input.phase);
  const repeatedFailures = input.repeatedFailures ?? inferRepeatedFailures(normalizedTask);
  const score = input.score;
  const provider = input.provider ?? inferProvider(normalizedTask);
  const qualityState = selectQualityState(
    score,
    repeatedFailures,
    normalizedTask,
    input.runnerStatus,
    input.artifactKind,
    input.outputPresent
  );

  return {
    phase,
    qualityState,
    dimensions: modelOutputEvaluationPolicy.dimensions,
    requiredChecks: requiredChecksForState(qualityState, phase),
    stopConditions: stopConditionsForState(qualityState, phase),
    nextActions: nextActionsForState(qualityState, phase),
    promptTuningActions: promptTuningActions(provider),
    escalationActions: escalationActionsForState(qualityState),
    sourceIds: modelOutputEvaluationPolicy.providerBestPracticeSources[provider]
  };
}

export function deriveLearningSignal(
  taskType: string,
  provider: ModelProviderFamily,
  records: readonly EvalRecordSummary[]
): SupervisorLearningSignal {
  const matchingRecords = records.filter((record) => record.taskType === taskType && record.provider === provider);
  const failureRecords = matchingRecords.filter((record) => record.state !== "accepted");
  const lastFailureLabels = failureRecords.at(-1)?.failureLabels ?? [];

  return {
    taskType,
    provider,
    recentFailureCount: failureRecords.length,
    lastFailureLabels,
    recommendedDelta: recommendDelta(provider, failureRecords, lastFailureLabels),
    confidenceSource:
      matchingRecords.length === 0
        ? "no_data"
        : matchingRecords.length === 1
          ? "single_observation"
          : "eval_records"
  };
}

export function selectWorkerOutputNextAction(
  loop: CorrectionLoopEntry,
  qualityState: ModelOutputQualityState
): WorkerOutputNormalization["nextAction"] {
  if (qualityState === "blocked") {
    return "blocked";
  }

  if (qualityState === "accepted") {
    return "accept";
  }

  if (loop.iterationCount >= loop.maxIterations) {
    return "escalate_model_route";
  }

  return "retry_with_correction";
}

function selectPhase(normalizedTask: string, explicitPhase?: ModelOutputEvaluationPhase): ModelOutputEvaluationPhase {
  if (explicitPhase) {
    return explicitPhase;
  }

  if (hasAny(normalizedTask, ["weekly", "batch", "trend", "collected data", "eval records"])) {
    return "weekly_batch_tuning";
  }

  return modelOutputEvaluationPolicy.defaultPhase;
}

function recommendDelta(
  provider: ModelProviderFamily,
  failureRecords: readonly EvalRecordSummary[],
  lastFailureLabels: readonly string[]
): SupervisorLearningSignal["recommendedDelta"] {
  if (failureRecords.length === 0) {
    return "no_change";
  }

  if (lastFailureLabels.some((label) => ["privacy_safety", "format_contract", "allowed_files"].includes(label))) {
    return "tighten_allowed_files";
  }

  if (failureRecords.length >= modelOutputEvaluationPolicy.repeatedFailureLimit) {
    return provider === "openai" ? "switch_to_qwen" : "decompose_task";
  }

  return "no_change";
}

function selectQualityState(
  score: number | undefined,
  repeatedFailures: number,
  normalizedTask: string,
  runnerStatus?: ModelProviderRunStatus,
  artifactKind?: ModelOutputArtifactKind,
  outputPresent?: boolean
): ModelOutputQualityState {
  if (hasRunnerArtifactBlocker(normalizedTask, runnerStatus, artifactKind, outputPresent)) {
    return "blocked";
  }

  if (hasAny(normalizedTask, ["blocked", "missing source", "missing owner", "secret", "private data"])) {
    return "blocked";
  }

  if (repeatedFailures >= modelOutputEvaluationPolicy.repeatedFailureLimit) {
    return "review_model_or_reasoning_route";
  }

  if (typeof score !== "number") {
    return "needs_scoring";
  }

  if (score >= modelOutputEvaluationPolicy.acceptanceThreshold) {
    return "accepted";
  }

  return "retry_with_prompt_or_input_tuning";
}

function requiredChecksForState(
  qualityState: ModelOutputQualityState,
  phase: ModelOutputEvaluationPhase
): string[] {
  const checks: string[] = [...modelOutputEvaluationPolicy.requiredChecks];

  if (qualityState === "review_model_or_reasoning_route") {
    checks.push("select_reasoning_model_route_rerun", "model_or_reasoning_change_reason_recorded");
  }

  if (phase === "weekly_batch_tuning") {
    checks.push("weekly_eval_summary_created", "prompt_changes_grouped_by_failure_pattern");
  }

  return unique(checks);
}

function stopConditionsForState(
  qualityState: ModelOutputQualityState,
  phase: ModelOutputEvaluationPhase
): string[] {
  const stopConditions: string[] = [...modelOutputEvaluationPolicy.stopConditions];

  if (qualityState === "review_model_or_reasoning_route") {
    stopConditions.push("route_review_skipped_after_repeated_bad_outputs");
  }

  if (phase === "weekly_batch_tuning") {
    stopConditions.push("weekly_prompt_change_without_eval_trend");
  }

  return unique(stopConditions);
}

function nextActionsForState(
  qualityState: ModelOutputQualityState,
  phase: ModelOutputEvaluationPhase
): string[] {
  if (qualityState === "accepted") {
    return ["record_accepted_eval", "link_verification_evidence", "keep_prompt_version_or_input_packet"];
  }

  if (qualityState === "review_model_or_reasoning_route") {
    return [
      "summarize_failure_pattern",
      "rerun_token_efficiency_route",
      "rerun_reasoning_model_route",
      "choose_different_reasoning_or_model_only_after_source_verified"
    ];
  }

  if (qualityState === "blocked") {
    return [
      "record_provider_run_artifact",
      "verify_model_output_presence",
      "set_progress_blocked_or_waiting_owner",
      "record_blocker_owner_or_source_needed",
      "do_not_rerun_until_missing_context_or_privacy_issue_is_resolved"
    ];
  }

  if (phase === "weekly_batch_tuning") {
    return ["aggregate_eval_records", "identify_repeated_failure_patterns", "propose_prompt_or_input_changes"];
  }

  return ["score_output_by_dimension", "adjust_prompt_or_input_packet", "rerun_same_route_once", "record_delta_and_result"];
}

function hasRunnerArtifactBlocker(
  normalizedTask: string,
  runnerStatus?: ModelProviderRunStatus,
  artifactKind?: ModelOutputArtifactKind,
  outputPresent?: boolean
): boolean {
  if (runnerStatus === "failed" || runnerStatus === "not_run") {
    return true;
  }

  if (outputPresent === false) {
    return true;
  }

  if (artifactKind === "runner_log" || artifactKind === "prompt_only" || artifactKind === "mixed_log") {
    return true;
  }

  return hasAny(normalizedTask, [
    "cli syntax error",
    "command failed",
    "provider unavailable",
    "provider availability unverified",
    "runner log",
    "prompt only",
    "no model output",
    "missing model output",
    "model output missing",
    "output missing",
    "incomplete output",
    "invalid artifact",
    "trust flag failed"
  ]);
}

function promptTuningActions(provider: ModelProviderFamily): string[] {
  const common = [
    "keep_task_small_with_caveman_context_when_possible",
    "separate_verified_facts_from_assumptions",
    "make_expected_output_and_format_contract_explicit",
    "tighten_allowed_files_tools_and_forbidden_actions",
    "preserve_source_pointers_for_next_handoff"
  ];

  const providerSpecific: Record<ModelProviderFamily, string[]> = {
    openai: ["use_structured_outputs_when_contract_matters", "prefer_evals_or_deterministic_graders_for_regression"],
    anthropic: ["define_success_criteria_first", "use_clear_rubrics_and_examples_for_judgment_tasks"],
    google: ["use_clear_direct_instructions", "place_specific_question_after_large_context"],
    qwen: ["use_model_chat_template_or_tool_template", "keep_local_worker_scope_bounded"],
    deepseek: ["use_json_mode_for_strict_json", "review_reasoning_mode_before_escalating_effort"],
    local: ["prefer_rg_and_deterministic_checks", "use_local_worker_output_as_draft_only"],
    unknown: ["identify_provider_before_provider_specific_tuning", "use_local_prompt_library_defaults"]
  };

  return [...common, ...providerSpecific[provider]];
}

function escalationActionsForState(qualityState: ModelOutputQualityState): string[] {
  if (qualityState !== "review_model_or_reasoning_route") {
    return ["do_not_change_model_without_failure_pattern"];
  }

  return [
    "compare_failure_pattern_to_provider_best_practices",
    "increase_reasoning_only_if_task_complexity_requires_it",
    "switch_model_or_provider_only_after_entitlement_privacy_and_cost_checks",
    "keep_new_output_advisory_until_scored_and_verified"
  ];
}

function inferRepeatedFailures(normalizedTask: string): number {
  if (hasAny(normalizedTask, ["third failure", "repeated bad", "keeps failing", "several bad outputs"])) {
    return modelOutputEvaluationPolicy.repeatedFailureLimit;
  }

  if (hasAny(normalizedTask, ["second failure", "failed twice"])) {
    return 2;
  }

  if (hasAny(normalizedTask, ["bad output", "poor output", "wrong output", "failed output"])) {
    return 1;
  }

  return 0;
}

function inferProvider(normalizedTask: string): ModelProviderFamily {
  if (hasAny(normalizedTask, ["openai", "gpt", "codex"])) return "openai";
  if (hasAny(normalizedTask, ["anthropic", "claude"])) return "anthropic";
  if (hasAny(normalizedTask, ["google", "gemini"])) return "google";
  if (hasAny(normalizedTask, ["qwen"])) return "qwen";
  if (hasAny(normalizedTask, ["deepseek"])) return "deepseek";
  if (hasAny(normalizedTask, ["local", "deterministic", "caveman"])) return "local";
  return "unknown";
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
