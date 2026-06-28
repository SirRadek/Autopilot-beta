export type LocalWorkerId =
  | "qwen2_5_coder_7b_fast"
  | "qwen2_5_coder_14b_max"
  | "local_static_analysis"
  | "local_test_runner"
  | "local_search_index"
  | "local_summarizer";

export type LocalWorkerKind = "llm_coding" | "deterministic_tool" | "llm_summary";

export type LocalWorkerStatus = "available" | "candidate_install_required" | "built_in";

export type LocalWorkerTaskKind =
  | "micro_coding"
  | "bounded_refactor"
  | "test_generation"
  | "bug_triage"
  | "summarization"
  | "search_or_index"
  | "deterministic_verification"
  | "architecture_or_security_review";

export interface LocalHardwareProfile {
  readonly checkedAt: string;
  readonly machine: string;
  readonly cpu: string;
  readonly ramGb: number;
  readonly gpu: string;
  readonly vramGb: number;
  readonly runtime: readonly string[];
  readonly installedModels: readonly string[];
}

export interface LocalWorkerPolicy {
  readonly id: LocalWorkerId;
  readonly title: string;
  readonly kind: LocalWorkerKind;
  readonly runtime: readonly string[];
  readonly status: LocalWorkerStatus;
  readonly modelTag?: string;
  readonly useFor: readonly LocalWorkerTaskKind[];
  readonly maxScope: readonly string[];
  readonly forbiddenUse: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface LocalWorkerRouteInput {
  readonly task: string;
}

export interface LocalWorkerRouteResult {
  readonly route: "deterministic_first" | "qwen_fast_worker" | "qwen_max_worker" | "local_summary_worker" | "human_or_frontier_review";
  readonly selectedWorkers: readonly LocalWorkerId[];
  readonly taskKinds: readonly LocalWorkerTaskKind[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly handoff: readonly string[];
}

export const localHardwareProfile = {
  checkedAt: "2026-05-30",
  machine: "HP Victus 16-r1xxx",
  cpu: "Intel Core i7-14700HX, 20 cores / 28 threads",
  ramGb: 32,
  gpu: "NVIDIA GeForce RTX 4070 Laptop GPU",
  vramGb: 8,
  runtime: ["ollama", "node", "python", "nvidia-smi"],
  installedModels: ["qwen2.5-coder:7b", "qwen2.5-coder:7b-autopilot"]
} as const satisfies LocalHardwareProfile;

export const localWorkerPolicies = [
  {
    id: "local_search_index",
    title: "Local Search / Index Worker",
    kind: "deterministic_tool",
    runtime: ["rg", "git", "node"],
    status: "built_in",
    useFor: ["search_or_index", "bug_triage"],
    maxScope: ["repository_search", "symbol_lookup", "diff_context", "dependency_trace"],
    forbiddenUse: ["semantic_guessing_without_sources", "approval", "secret_collection"],
    requiredChecks: ["prefer_rg", "read_only_search", "small_context_packet"],
    stopConditions: ["full_repo_dump_requested_without_reason", "private_secret_in_prompt"]
  },
  {
    id: "local_static_analysis",
    title: "Local Static Analysis Worker",
    kind: "deterministic_tool",
    runtime: ["tsc", "vitest", "astro", "playwright"],
    status: "built_in",
    useFor: ["deterministic_verification", "bug_triage"],
    maxScope: ["typecheck", "unit_tests", "build", "e2e_smoke", "diff_check"],
    forbiddenUse: ["business_decision", "architecture_approval", "visual_taste_decision"],
    requiredChecks: ["run_targeted_check_first", "record_command_evidence", "do_not_replace_review"],
    stopConditions: ["verification_command_missing", "test_failure_untriaged"]
  },
  {
    id: "qwen2_5_coder_7b_fast",
    title: "Qwen2.5-Coder 7B Fast Local Worker",
    kind: "llm_coding",
    runtime: ["ollama"],
    status: "available",
    modelTag: "qwen2.5-coder:7b",
    useFor: ["micro_coding", "test_generation", "bug_triage", "summarization"],
    maxScope: ["single_file_patch_draft", "small_test_draft", "error_summary", "local_explanation"],
    forbiddenUse: ["architecture_decision", "security_approval", "large_refactor", "final_delivery_approval"],
    requiredChecks: ["model_available_locally", "bounded_file_scope", "diff_review_required", "tests_required"],
    stopConditions: ["local_model_unavailable", "task_requires_architecture_decision", "output_used_without_review"]
  },
  {
    id: "qwen2_5_coder_14b_max",
    title: "Qwen2.5-Coder 14B Max Local Coding Worker",
    kind: "llm_coding",
    runtime: ["ollama"],
    status: "candidate_install_required",
    modelTag: "qwen2.5-coder:14b",
    useFor: ["bounded_refactor", "test_generation", "bug_triage", "micro_coding"],
    maxScope: ["bounded_multi_file_patch_draft", "code_repair_draft", "test_strategy_draft", "refactor_plan"],
    forbiddenUse: ["unbounded_repo_editing", "architecture_approval", "security_approval", "business_decision"],
    requiredChecks: [
      "model_install_confirmed",
      "hardware_budget_verified",
      "bounded_file_scope",
      "diff_review_required",
      "tests_required"
    ],
    stopConditions: [
      "local_model_unavailable",
      "hardware_budget_unverified",
      "context_too_large_for_local_worker",
      "task_requires_architecture_decision",
      "output_used_without_review"
    ]
  },
  {
    id: "local_summarizer",
    title: "Local Summarizer Worker",
    kind: "llm_summary",
    runtime: ["ollama"],
    status: "available",
    modelTag: "qwen2.5-coder:7b-autopilot",
    useFor: ["summarization", "search_or_index"],
    maxScope: ["run_summary", "diff_summary", "work_log_draft", "handoff_draft"],
    forbiddenUse: ["source_rewrite", "approval", "unverified_fact_creation"],
    requiredChecks: ["source_refs_required", "summary_must_preserve_uncertainty", "human_readback_for_final_handoff"],
    stopConditions: ["source_context_missing", "summary_overwrites_source_artifact"]
  },
  {
    id: "local_test_runner",
    title: "Local Test Runner Worker",
    kind: "deterministic_tool",
    runtime: ["npm", "playwright", "vitest"],
    status: "built_in",
    useFor: ["deterministic_verification", "test_generation"],
    maxScope: ["targeted_tests", "full_verify", "browser_smoke", "regression_check"],
    forbiddenUse: ["approving_missing_tests", "ignoring_failure", "changing_scope"],
    requiredChecks: ["targeted_before_full_verify", "failure_summary_required", "no_silent_skip"],
    stopConditions: ["test_failure_untriaged", "missing_acceptance_criteria"]
  }
] as const satisfies readonly LocalWorkerPolicy[];

export function selectLocalWorkerRoute(input: LocalWorkerRouteInput): LocalWorkerRouteResult {
  const normalizedTask = normalize(input.task);
  const taskKinds = classifyTask(normalizedTask);
  const selectedWorkers = selectWorkersForTask(taskKinds, normalizedTask);

  return {
    route: selectRoute(selectedWorkers, taskKinds),
    selectedWorkers,
    taskKinds,
    requiredChecks: unique(selectedWorkers.flatMap((id) => requireLocalWorker(id).requiredChecks)),
    stopConditions: unique(selectedWorkers.flatMap((id) => requireLocalWorker(id).stopConditions)),
    handoff: [
      "produce_patch_or_analysis_draft_only",
      "supervisor_reviews_diff_or_claims",
      "deterministic_tests_run_before_acceptance",
      "record_model_choice_when_it_affects_risk_or_delivery"
    ]
  };
}

function classifyTask(normalizedTask: string): LocalWorkerTaskKind[] {
  const kinds: LocalWorkerTaskKind[] = [];

  if (hasAny(normalizedTask, ["rg", "search", "find", "index", "symbol", "trace"])) {
    kinds.push("search_or_index");
  }

  if (hasAny(normalizedTask, ["test", "vitest", "playwright", "verify", "typecheck", "build"])) {
    kinds.push("deterministic_verification");
  }

  if (hasAny(normalizedTask, ["summarize", "summary", "handoff", "work log", "compact"])) {
    kinds.push("summarization");
  }

  if (hasAny(normalizedTask, ["dto", "boilerplate", "small", "single file", "micro"])) {
    kinds.push("micro_coding");
  }

  if (hasAny(normalizedTask, ["refactor", "multi file", "repair", "bug", "fix", "tests"])) {
    kinds.push("bounded_refactor", "bug_triage", "test_generation");
  }

  if (hasAny(normalizedTask, ["architecture", "security", "payment", "auth", "governance", "public api"])) {
    kinds.push("architecture_or_security_review");
  }

  return unique(kinds.length > 0 ? kinds : ["micro_coding"]);
}

function selectWorkersForTask(taskKinds: readonly LocalWorkerTaskKind[], normalizedTask: string): LocalWorkerId[] {
  const workers: LocalWorkerId[] = [];

  if (taskKinds.includes("search_or_index") || taskKinds.includes("bug_triage")) {
    workers.push("local_search_index");
  }

  if (taskKinds.includes("deterministic_verification")) {
    workers.push("local_static_analysis", "local_test_runner");
  }

  if (taskKinds.includes("summarization")) {
    workers.push("local_summarizer");
  }

  if (taskKinds.includes("bounded_refactor") || hasAny(normalizedTask, ["14b", "maximum", "max"])) {
    workers.push("qwen2_5_coder_14b_max");
  } else if (taskKinds.includes("micro_coding") || taskKinds.includes("test_generation")) {
    workers.push("qwen2_5_coder_7b_fast");
  }

  if (taskKinds.includes("architecture_or_security_review")) {
    workers.push("local_search_index");
  }

  return unique(workers.length > 0 ? workers : ["qwen2_5_coder_7b_fast"]);
}

function selectRoute(
  workers: readonly LocalWorkerId[],
  taskKinds: readonly LocalWorkerTaskKind[]
): LocalWorkerRouteResult["route"] {
  if (taskKinds.includes("architecture_or_security_review")) {
    return "human_or_frontier_review";
  }

  if (workers.includes("qwen2_5_coder_14b_max")) {
    return "qwen_max_worker";
  }

  if (workers.includes("qwen2_5_coder_7b_fast")) {
    return "qwen_fast_worker";
  }

  if (workers.includes("local_summarizer")) {
    return "local_summary_worker";
  }

  return "deterministic_first";
}

function requireLocalWorker(id: LocalWorkerId): LocalWorkerPolicy {
  const worker = localWorkerPolicies.find((candidate) => candidate.id === id);

  if (!worker) {
    throw new Error(`Local worker not found: ${id}`);
  }

  return worker;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function hasAny(normalizedTask: string, terms: readonly string[]): boolean {
  return terms.some((term) => normalizedTask.includes(normalize(term)));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
