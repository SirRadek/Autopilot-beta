import {
  type EvalRecordSummary,
  type ModelProviderFamily,
  type SupervisorLearningSignal,
  deriveLearningSignal
} from "./modelOutputEvaluation";
import type { SubscriptionRateLimitState, SubscriptionSessionBudget } from "./subscriptionBudget";
import {
  type ContextWidthSpec,
  type TokenEfficiencyProfileId,
  selectContextWidth,
  selectTokenEfficiencyRoute
} from "./tokenEfficiency";
import { resolveFallback } from "./fallbackChains";

export type ModelPolicyLayer =
  | "orchestrator"
  | "architect"
  | "reviewer"
  | "tester"
  | "micro_worker"
  | "bounded_coding"
  | "memory_summarizer"
  | "copywriter";

export type ReasoningProviderId =
  | "deterministic_tools"
  | "qwen_local"
  | "openai_gpt"
  | "anthropic_claude_subscription"
  | "gemini_cli"
  | "deepseek_api_or_self_hosted"
  | "deepseek_web_chat_manual";

export type ReasoningTaskLaneId =
  | "deterministic_verification"
  | "local_routine_worker"
  | "bounded_coding_worker"
  | "structured_tool_reasoning"
  | "long_context_synthesis"
  | "multimodal_design_review"
  | "architecture_security_review"
  | "agent_validation"
  | "sensitive_private_context";

export type ReasoningAccessMode =
  | "deterministic"
  | "local"
  | "session_cli"
  | "subscription_cli"
  | "subscription_interactive"
  | "api_or_self_hosted"
  | "manual_web_login";

export type AdvisoryTrustTier =
  | "local_evidence"
  | "high_trust_advisory"
  | "standard_advisory"
  | "bounded_draft"
  | "comparison_only";

export interface ModelPolicyRule {
  layer: ModelPolicyLayer;
  preferredCapability: string;
  allowedUse: string;
  forbiddenUse: string;
}

export interface ReasoningEscalationPolicy {
  defaultWorkerLayer: "local_swarm";
  strategicLayer: "frontier_reasoning";
  localDefaultUse: readonly string[];
  freeCloudAdvisoryUse: readonly string[];
  docsVerificationProviders: readonly string[];
  frontierEscalationUse: readonly string[];
  frontierForbiddenUse: readonly string[];
  requiredChecks: readonly string[];
  stopConditions: readonly string[];
}

export interface ReasoningProviderPolicy {
  readonly id: ReasoningProviderId;
  readonly provider: string;
  readonly accessMode: ReasoningAccessMode;
  readonly costGuard?: string;
  readonly advisoryTrustTier: AdvisoryTrustTier;
  readonly advisoryWeight: number;
  readonly contextScope: string;
  readonly bestFor: readonly string[];
  readonly avoidFor: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly sourceIds: readonly string[];
}

export interface ReasoningTaskLanePolicy {
  readonly id: ReasoningTaskLaneId;
  readonly taskSignals: readonly string[];
  readonly preferredProviders: readonly ReasoningProviderId[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface SupervisorRoutingDecision {
  readonly taskId: string;
  readonly layer: ModelPolicyLayer;
  readonly tokenEfficiencyProfile: TokenEfficiencyProfileId;
  readonly contextWidthSpec: ContextWidthSpec;
  readonly taskLane: ReasoningTaskLaneId;
  readonly assignedProvider: ReasoningProviderId;
  readonly assignedTierId: string | undefined;
  readonly subscriptionBudgetState: SubscriptionRateLimitState;
  readonly fallbackProvider: ReasoningProviderId | "owner_decision" | "blocked";
  readonly learningSignal: SupervisorLearningSignal | undefined;
  readonly decisionReasoning: string;
}

export interface CredentialedAdvisoryProviderPolicy {
  readonly id: string;
  readonly provider: string;
  readonly tool: string;
  readonly accessMode: "subscription_interactive";
  readonly registration: "optional";
  readonly costGuard: string;
  readonly advisoryTrustTier: AdvisoryTrustTier;
  readonly advisoryWeight: number;
  readonly contextScope: string;
  readonly allowedUse: readonly string[];
  readonly forbiddenUse: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly sourceDocs: readonly string[];
}

export interface ReasoningModelRouteInput {
  readonly task: string;
}

export interface ReasoningModelRouteResult {
  readonly route: "local_worker_default" | "free_cloud_advisory_review" | "external_advisory_review";
  readonly taskLanes: readonly ReasoningTaskLaneId[];
  readonly providerPolicies: readonly ReasoningProviderId[];
  readonly advisoryProviders: readonly string[];
  readonly docsVerificationProviders: readonly string[];
  readonly allowedUse: readonly string[];
  readonly forbiddenUse: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export const modelPolicyRules = [
  {
    layer: "orchestrator",
    preferredCapability: "strong reasoning",
    allowedUse: "dependency planning and routing",
    forbiddenUse: "self-approval or governance bypass"
  },
  {
    layer: "architect",
    preferredCapability: "strong architecture reasoning",
    allowedUse: "system design and boundary review",
    forbiddenUse: "silent architecture changes"
  },
  {
    layer: "reviewer",
    preferredCapability: "independent critique",
    allowedUse: "quality, security, architecture, and UX review",
    forbiddenUse: "approving own implementation"
  },
  {
    layer: "tester",
    preferredCapability: "verification reasoning",
    allowedUse: "test strategy, regression checks, and failure summaries",
    forbiddenUse: "changing business scope"
  },
  {
    layer: "micro_worker",
    preferredCapability: "bounded code generation",
    allowedUse: "small isolated tasks such as tests, DTOs, utilities, and focused bugfixes",
    forbiddenUse: "architecture, governance, or business decisions"
  },
  {
    layer: "bounded_coding",
    preferredCapability: "focused implementation",
    allowedUse: "bounded implementation with explicit ownership",
    forbiddenUse: "unbounded autonomous execution"
  },
  {
    layer: "memory_summarizer",
    preferredCapability: "low-cost summarization",
    allowedUse: "summaries, lessons, and run memory compaction",
    forbiddenUse: "final approval"
  },
  {
    layer: "copywriter",
    preferredCapability: "language quality",
    allowedUse: "UX copy, documentation wording, and localization review",
    forbiddenUse: "scope or architecture approval"
  }
] as const satisfies readonly ModelPolicyRule[];

export const layerProviderMapping = {
  orchestrator: "anthropic_claude_subscription",
  architect: "anthropic_claude_subscription",
  reviewer: "anthropic_claude_subscription",
  tester: "openai_gpt",
  micro_worker: "openai_gpt",
  bounded_coding: "openai_gpt",
  memory_summarizer: "gemini_cli",
  copywriter: "openai_gpt"
} as const satisfies Record<ModelPolicyLayer, ReasoningProviderId>;

export type CliVendorSelection = "codex_cli" | "agy_cli" | null;

// Maps each orchestration layer to the CLI vendor dispatched via runCliWorker().
// null = Claude handles this layer directly (orchestrator, memory_summarizer).
// codex_cli = bounded implementation/code/tests (OpenAI Codex CLI).
// agy_cli   = analysis/brainstorming/critique (agy CLI).
export const supervisorCliVendorMap = {
  orchestrator: null,
  architect: "agy_cli",
  reviewer: "agy_cli",
  tester: "codex_cli",
  micro_worker: "codex_cli",
  bounded_coding: "codex_cli",
  memory_summarizer: null,
  copywriter: "agy_cli"
} as const satisfies Record<ModelPolicyLayer, CliVendorSelection>;

export function resolveCliVendorForLayer(layer: ModelPolicyLayer): CliVendorSelection {
  return supervisorCliVendorMap[layer];
}

export const reasoningEscalationPolicy = {
  defaultWorkerLayer: "local_swarm",
  strategicLayer: "frontier_reasoning",
  localDefaultUse: [
    "boilerplate coding",
    "bounded worker tasks",
    "autocomplete",
    "embeddings",
    "RAG retrieval",
    "indexing",
    "automation loops",
    "routine summarization"
  ],
  freeCloudAdvisoryUse: [
    "brainstorming",
    "architecture second opinion",
    "design critique",
    "security critique",
    "planning critique",
    "agent validation",
    "edge-case review",
    "research synthesis"
  ],
  docsVerificationProviders: [
    "context7_when_available",
    "official_docs_fallback",
    "local_files",
    "tests",
    "controlled_browser_evidence"
  ],
  frontierEscalationUse: [
    "deep research",
    "architecture review",
    "security audit",
    "code review",
    "agent validation",
    "strategic planning",
    "orchestration design",
    "edge-case reasoning",
    "cross-domain tradeoff analysis"
  ],
  frontierForbiddenUse: [
    "autocomplete",
    "boilerplate coding",
    "embeddings",
    "routine summarization",
    "simple tasks",
    "local automation loops",
    "unreviewed worker execution"
  ],
  requiredChecks: [
    "provider_availability_verified",
    "provider_run_status_recorded",
    "model_output_presence_verified",
    "free_tier_or_no_cost_confirmed",
    "subscription_entitlement_confirmed_for_subscription_tools",
    "google_ai_subscription_entitlement_confirmed_for_gemini_cli",
    "redacted_context_only",
    "context7_or_official_docs_verified",
    "gemini_brainstorm_claims_labeled_and_verified",
    "factual_claims_verified",
    "smallest_safe_model_class",
    "disclose_model_choice_when_risk_affects_delivery"
  ],
  stopConditions: [
    "non_local_worker_dependency",
    "cloud_model_for_routine_worker_loop",
    "frontier_used_for_simple_worker_task",
    "provider_availability_unverified",
    "provider_run_failed_without_blocked_state",
    "model_output_missing_from_artifact",
    "advisory_workflow_continued_after_provider_error",
    "paid_model_or_credit_required",
    "subscription_entitlement_unverified",
    "google_ai_subscription_entitlement_unverified",
    "api_credit_path_requested_without_owner_decision",
    "gemini_api_key_or_paid_api_path_requested_without_owner_decision",
    "private_data_not_redacted",
    "model_output_used_as_source_of_truth",
    "technology_claim_without_context7_or_official_docs",
    "gemini_claim_adopted_without_verification"
  ]
} as const satisfies ReasoningEscalationPolicy;

export const reasoningProviderPolicies = [
  {
    id: "deterministic_tools",
    provider: "local",
    accessMode: "deterministic",
    advisoryTrustTier: "local_evidence",
    advisoryWeight: 100,
    contextScope: "local repository evidence, commands, tests, schemas, and generated artifacts inside the declared workspace",
    bestFor: ["repository search", "tests", "typecheck", "schema validation", "diff checks"],
    avoidFor: ["semantic architecture judgment", "ambiguous business decisions"],
    requiredChecks: ["local_command_scope_known", "no_secret_exfiltration", "results_recorded"],
    stopConditions: ["destructive_command_without_owner_approval", "unknown_workspace_boundary"],
    sourceIds: ["local-agents-md", "decision-mesh-policy"]
  },
  {
    id: "qwen_local",
    provider: "qwen",
    accessMode: "local",
    advisoryTrustTier: "bounded_draft",
    advisoryWeight: 45,
    contextScope: "bounded local file context for drafts and summaries; supervisor review and tests are required before adoption",
    bestFor: ["small file-local code drafts", "routine test drafts", "handoff summaries", "bounded refactor drafts"],
    avoidFor: ["architecture approval", "security approval", "business decisions", "final delivery approval"],
    requiredChecks: ["local_runtime_available", "bounded_file_scope", "independent_review", "test_evidence"],
    stopConditions: ["local_model_unavailable", "private_secret_in_prompt", "broad_ambiguous_scope"],
    sourceIds: ["qwen-chat-template", "qwen-function-calling", "qwen2-5-7b-model-card", "qwen2-5-coder-14b-model-card"]
  },
  {
    id: "openai_gpt",
    provider: "openai",
    accessMode: "subscription_interactive",
    costGuard: "uses_owner_subscription_entitlement_not_api_credit",
    advisoryTrustTier: "high_trust_advisory",
    advisoryWeight: 85,
    contextScope: "redacted strategic, structured, or bounded worker context after subscription entitlement and official-doc checks",
    bestFor: ["structured outputs", "tool orchestration", "deep reasoning review", "Codex coding supervision"],
    avoidFor: ["unredacted private context without approval", "routine boilerplate loops", "unchecked pricing assumptions"],
    requiredChecks: [
      "provider_availability_verified",
      "cost_or_entitlement_confirmed",
      "subscription_entitlement_confirmed_for_subscription_tools",
      "serial_task_delegation_required",
      "redacted_context_only",
      "official_provider_docs_verified",
      "local_verification_required"
    ],
    stopConditions: [
      "provider_availability_unverified",
      "subscription_entitlement_unverified",
      "parallel_subscription_calls_attempted",
      "mid_task_rate_limit_without_checkpoint",
      "paid_model_or_credit_required_without_owner_decision",
      "private_data_not_redacted",
      "model_output_used_as_source_of_truth"
    ],
    sourceIds: ["openai-reasoning-best-practices", "openai-structured-outputs", "openai-prompt-engineering"]
  },
  {
    id: "anthropic_claude_subscription",
    provider: "anthropic",
    accessMode: "subscription_interactive",
    advisoryTrustTier: "high_trust_advisory",
    advisoryWeight: 90,
    contextScope:
      "broad repository read after owner scope, excluding secrets, credentials, customer data, raw logs, and unapproved remote mutation paths",
    bestFor: ["architecture second opinion", "security critique", "planning critique", "agent validation", "edge-case review"],
    avoidFor: ["API-credit execution without owner decision", "default routine worker", "local automation loops"],
    requiredChecks: [
      "provider_availability_verified",
      "subscription_entitlement_confirmed",
      "authentication_state_verified_without_token_disclosure",
      "redacted_context_only",
      "claude_broad_read_scope_owner_scoped",
      "official_provider_docs_verified",
      "bounded_scope_declared",
      "local_verification_required"
    ],
    stopConditions: [
      "provider_availability_unverified",
      "subscription_entitlement_unverified",
      "api_credit_path_requested_without_owner_decision",
      "private_data_not_redacted",
      "model_output_used_as_source_of_truth",
      "remote_mutation_without_approval"
    ],
    sourceIds: [
      "anthropic-claude-code-setup",
      "anthropic-claude-code-authentication",
      "anthropic-claude-code-memory",
      "anthropic-tool-use",
      "anthropic-context-windows"
    ]
  },
  {
    id: "gemini_cli",
    provider: "google",
    accessMode: "subscription_cli",
    advisoryTrustTier: "standard_advisory",
    advisoryWeight: 70,
    contextScope:
      "redacted strategy, brainstorming, multimodal, or selected long-context packets; no broad private repository dump by default",
    bestFor: ["long-context brainstorming", "multimodal critique", "architecture alternatives", "edge-case ideation"],
    avoidFor: [
      "source-of-truth claims",
      "unredacted private context",
      "Gemini API key or paid API path without owner decision",
      "free-tier assumption for owner subscription usage",
      "primary implementation worker",
      "default fallback when GPT unavailable"
    ],
    requiredChecks: [
      "provider_availability_verified",
      "google_ai_subscription_entitlement_confirmed_for_gemini_cli",
      "authentication_state_verified_without_token_disclosure",
      "gemini_session_budget_tracked",
      "gemini_not_primary_worker",
      "redacted_context_only",
      "gemini_brainstorm_claims_labeled_and_verified",
      "context7_or_official_docs_verified",
      "local_verification_required"
    ],
    stopConditions: [
      "provider_availability_unverified",
      "google_ai_subscription_entitlement_unverified",
      "gemini_rate_limit_exhausted_without_pause",
      "gemini_used_as_default_worker",
      "gemini_api_key_or_paid_api_path_requested_without_owner_decision",
      "private_data_not_redacted",
      "gemini_claim_adopted_without_verification"
    ],
    sourceIds: [
      "gemini-code-assist-quotas",
      "gemini-subscriptions",
      "gemini-models",
      "gemini-long-context",
      "gemini-multimodal-prompt-design",
      "gemini-prompt-design-strategies"
    ]
  },
  {
    id: "deepseek_api_or_self_hosted",
    provider: "deepseek",
    accessMode: "api_or_self_hosted",
    advisoryTrustTier: "comparison_only",
    advisoryWeight: 40,
    contextScope: "minimal redacted comparison context after cost or self-hosting checks; not a broad private-context lane",
    bestFor: ["cost-aware coding critique", "JSON output", "reasoning-model comparison", "function calling when supported"],
    avoidFor: ["routine local loops", "tool-calling assumptions on unsupported reasoning models", "unverified hosted cost"],
    requiredChecks: [
      "provider_availability_verified",
      "cost_or_self_hosting_confirmed",
      "redacted_context_only",
      "official_provider_docs_verified",
      "local_verification_required"
    ],
    stopConditions: [
      "provider_availability_unverified",
      "paid_model_or_credit_required_without_owner_decision",
      "private_data_not_redacted",
      "unsupported_tool_mode_assumed",
      "model_output_used_as_source_of_truth"
    ],
    sourceIds: ["deepseek-reasoning-model", "deepseek-json-output", "deepseek-function-calling"]
  },
  {
    id: "deepseek_web_chat_manual",
    provider: "deepseek",
    accessMode: "manual_web_login",
    advisoryTrustTier: "comparison_only",
    advisoryWeight: 38,
    contextScope:
      "tiny redacted manual web-chat packet through chat.deepseek.com after browser-login availability is verified; no broad private repository context",
    bestFor: [
      "free web-chat second opinion",
      "Quick mode low-latency advisory",
      "Expert mode reasoning advisory",
      "manual prompt critique"
    ],
    avoidFor: [
      "CLI or API automation",
      "routine local loops",
      "broad private repository context",
      "headless browser automation as a stable runtime",
      "final approval"
    ],
    requiredChecks: [
      "provider_availability_verified",
      "free_tier_or_no_cost_confirmed",
      "authentication_state_verified_without_token_disclosure",
      "controlled_browser_evidence_required",
      "fresh_chat_started_for_each_mode_test",
      "redacted_context_only",
      "prompt_packet_bounded",
      "local_verification_required"
    ],
    stopConditions: [
      "provider_availability_unverified",
      "authentication_missing",
      "browser_session_unavailable",
      "mode_switch_unverified",
      "private_data_not_redacted",
      "broad_private_context_sent_to_lower_trust_model",
      "model_output_used_as_source_of_truth"
    ],
    sourceIds: ["deepseek-web-chat", "deepseek-thinking-mode", "deepseek-first-api-call", "deepseek-deepcode-integration"]
  }
] as const satisfies readonly ReasoningProviderPolicy[];

export const reasoningTaskLanePolicies = [
  {
    id: "deterministic_verification",
    taskSignals: ["test", "typecheck", "schema", "diff check", "audit", "build"],
    preferredProviders: ["deterministic_tools"],
    requiredChecks: ["local_command_scope_known", "results_recorded"],
    stopConditions: ["destructive_command_without_owner_approval"]
  },
  {
    id: "local_routine_worker",
    taskSignals: ["boilerplate", "dto", "small patch", "routine summarization", "indexing"],
    preferredProviders: ["deterministic_tools", "qwen_local"],
    requiredChecks: ["local_worker_default", "bounded_file_scope", "independent_review"],
    stopConditions: ["cloud_model_for_routine_worker_loop", "frontier_used_for_simple_worker_task"]
  },
  {
    id: "bounded_coding_worker",
    taskSignals: ["bounded implementation", "focused bugfix", "refactor", "test generation"],
    preferredProviders: ["openai_gpt", "qwen_local", "deterministic_tools"],
    requiredChecks: ["bounded_file_scope", "test_evidence", "supervisor_reviews_diff_or_claims"],
    stopConditions: ["broad_ambiguous_scope", "model_output_used_as_source_of_truth"]
  },
  {
    id: "structured_tool_reasoning",
    taskSignals: ["structured output", "json", "tool use", "function calling", "mcp schema"],
    preferredProviders: ["openai_gpt", "deepseek_api_or_self_hosted", "deterministic_tools"],
    requiredChecks: ["official_provider_docs_verified", "schema_validation_required", "local_verification_required"],
    stopConditions: ["unsupported_tool_mode_assumed", "technology_claim_without_context7_or_official_docs"]
  },
  {
    id: "long_context_synthesis",
    taskSignals: ["long context", "large document", "research synthesis", "broad planning"],
    preferredProviders: ["gemini_cli", "anthropic_claude_subscription", "openai_gpt"],
    requiredChecks: ["redacted_context_only", "context7_or_official_docs_verified", "factual_claims_verified"],
    stopConditions: ["private_data_not_redacted", "model_output_used_as_source_of_truth"]
  },
  {
    id: "multimodal_design_review",
    taskSignals: ["multimodal", "screenshot", "visual", "ux critique", "design critique"],
    preferredProviders: ["gemini_cli", "anthropic_claude_subscription", "openai_gpt"],
    requiredChecks: ["redacted_context_only", "accessibility_claims_verified", "local_visual_evidence_required"],
    stopConditions: ["private_data_not_redacted", "visual_claim_without_evidence"]
  },
  {
    id: "architecture_security_review",
    taskSignals: ["architecture", "security", "audit", "threat", "privacy", "edge case"],
    preferredProviders: [
      "openai_gpt",
      "anthropic_claude_subscription",
      "gemini_cli",
      "deepseek_api_or_self_hosted",
      "deepseek_web_chat_manual"
    ],
    requiredChecks: ["redacted_context_only", "independent_review", "factual_claims_verified", "local_verification_required"],
    stopConditions: ["model_output_used_as_source_of_truth", "private_data_not_redacted"]
  },
  {
    id: "agent_validation",
    taskSignals: ["agent validation", "supervisor", "handoff", "routing", "orchestration"],
    preferredProviders: ["anthropic_claude_subscription", "openai_gpt", "gemini_cli", "qwen_local"],
    requiredChecks: ["handoff_packet_normalized", "forbidden_actions_declared", "local_verification_required"],
    stopConditions: ["raw_agent_output_chained_as_prompt", "model_output_used_as_source_of_truth"]
  },
  {
    id: "sensitive_private_context",
    taskSignals: ["secret", "credential", "customer data", "private repo", "sensitive"],
    preferredProviders: ["deterministic_tools", "qwen_local"],
    requiredChecks: ["local_only_by_default", "secret_redaction_verified", "owner_exception_required_for_cloud"],
    stopConditions: ["private_data_not_redacted", "cloud_model_for_sensitive_context_without_owner_exception"]
  }
] as const satisfies readonly ReasoningTaskLanePolicy[];

export const credentialedAdvisoryProviderPolicies = [
  {
    id: "claude_code",
    provider: "anthropic",
    tool: "claude",
    accessMode: "subscription_interactive",
    registration: "optional",
    costGuard: "uses_owner_subscription_entitlement_not_api_credit",
    advisoryTrustTier: "high_trust_advisory",
    advisoryWeight: 90,
    contextScope:
      "broad repository read after owner scope, excluding secrets, credentials, customer data, raw logs, and unapproved remote mutation paths",
    allowedUse: [
      "architecture second opinion",
      "security critique",
      "planning critique",
      "agent validation",
      "edge-case review",
      "bounded repo session after owner scope"
    ],
    forbiddenUse: [
      "default routine worker",
      "local automation loops",
      "final approval",
      "governance approval",
      "unredacted private context",
      "unbounded autonomous execution",
      "remote mutation without explicit approval"
    ],
    requiredChecks: [
      "provider_availability_verified",
      "authentication_state_verified_without_token_disclosure",
      "subscription_entitlement_confirmed",
      "no_api_budget_or_credit_claim",
      "redacted_context_only",
      "claude_broad_read_scope_owner_scoped",
      "official_provider_docs_verified",
      "bounded_scope_declared",
      "local_verification_required",
      "disclose_model_choice_when_risk_affects_delivery"
    ],
    stopConditions: [
      "provider_availability_unverified",
      "authentication_missing",
      "subscription_entitlement_unverified",
      "api_credit_path_requested_without_owner_decision",
      "private_data_not_redacted",
      "model_output_used_as_source_of_truth",
      "cloud_model_for_routine_worker_loop",
      "remote_mutation_without_approval"
    ],
    sourceDocs: [
      "https://code.claude.com/docs/en/setup",
      "https://code.claude.com/docs/en/iam",
      "https://code.claude.com/docs/en/memory"
    ]
  },
  {
    id: "codex_gpt_worker",
    provider: "openai",
    tool: "codex",
    accessMode: "subscription_interactive",
    registration: "optional",
    costGuard: "uses_owner_subscription_entitlement_not_api_credit",
    advisoryTrustTier: "high_trust_advisory",
    advisoryWeight: 85,
    contextScope:
      "bounded implementation after a normalized handoff packet, with declared allowed files and forbidden actions",
    allowedUse: [
      "bounded implementation with handoff packet",
      "test generation",
      "security implementation",
      "business logic",
      "focused bugfix",
      "refactor within declared scope"
    ],
    forbiddenUse: [
      "architecture decisions",
      "governance approval",
      "orchestration planning",
      "self-approval",
      "scope expansion without supervisor handoff"
    ],
    requiredChecks: [
      "handoff_packet_received_before_start",
      "subscription_entitlement_confirmed_for_subscription_tools",
      "serial_task_delegation_required",
      "allowed_files_declared",
      "forbidden_actions_declared"
    ],
    stopConditions: [
      "handoff_packet_missing_before_session_open",
      "parallel_subscription_calls_attempted",
      "allowed_files_missing",
      "forbidden_actions_missing",
      "scope_expansion_without_supervisor_handoff"
    ],
    sourceDocs: ["prompt-library/01-gpt/codex-bounded-worker.md", "AGENTS.md"]
  }
] as const satisfies readonly CredentialedAdvisoryProviderPolicy[];

export function selectReasoningModelRoute(input: ReasoningModelRouteInput): ReasoningModelRouteResult {
  const normalizedTask = normalize(input.task);
  const isRoutine = hasAny(normalizedTask, [
    "autocomplete",
    "boilerplate",
    "dto",
    "embeddings",
    "indexing",
    "automation loop",
    "routine summarization",
    "simple task"
  ]);
  const benefitsFromAdvisory = hasAny(normalizedTask, [
    "brainstorm",
    "critique",
    "review",
    "architecture",
    "security",
    "audit",
    "planning",
    "edge case",
    "research",
    "reasoning",
    "validation"
  ]);

  if (benefitsFromAdvisory && !isRoutine) {
    const taskLanes = selectTaskLanes(normalizedTask);
    const providerPolicies = selectProviderPolicies(taskLanes);
    return {
      route: "external_advisory_review",
      taskLanes,
      providerPolicies,
      advisoryProviders: selectAdvisoryProviders(normalizedTask, providerPolicies),
      docsVerificationProviders: reasoningEscalationPolicy.docsVerificationProviders,
      allowedUse: reasoningEscalationPolicy.freeCloudAdvisoryUse,
      forbiddenUse: reasoningEscalationPolicy.frontierForbiddenUse,
      requiredChecks: unique([
        ...reasoningEscalationPolicy.requiredChecks,
        ...requiredChecksForProviders(providerPolicies),
        ...requiredChecksForTaskLanes(taskLanes)
      ]),
      stopConditions: unique([
        ...reasoningEscalationPolicy.stopConditions,
        ...stopConditionsForProviders(providerPolicies),
        ...stopConditionsForTaskLanes(taskLanes)
      ])
    };
  }

  return {
    route: "local_worker_default",
    taskLanes: ["local_routine_worker"],
    providerPolicies: ["deterministic_tools", "qwen_local"],
    advisoryProviders: ["local_worker", "local_llm_when_available"],
    docsVerificationProviders: reasoningEscalationPolicy.docsVerificationProviders,
    allowedUse: reasoningEscalationPolicy.localDefaultUse,
    forbiddenUse: [
      "architecture decisions",
      "business decisions",
      "governance approval",
      "security approval",
      "unbounded autonomous execution",
      "final delivery approval"
    ],
    requiredChecks: [
      "local_worker_default",
      "smallest_safe_model_class",
      "disclose_model_choice_when_risk_affects_delivery"
    ],
    stopConditions: [
      "cloud_model_for_routine_worker_loop",
      "frontier_used_for_simple_worker_task",
      "model_output_used_as_source_of_truth"
    ]
  };
}

export function buildSupervisorRoutingDecision(input: {
  readonly taskId: string;
  readonly taskDescription: string;
  readonly layer: ModelPolicyLayer;
  readonly budgets: readonly SubscriptionSessionBudget[];
  readonly evalRecords: readonly EvalRecordSummary[];
}): SupervisorRoutingDecision {
  const tokenEfficiencyRoute = selectTokenEfficiencyRoute({ task: input.taskDescription });
  const contextWidthSpec = selectContextWidth(tokenEfficiencyRoute.profile, [
    input.layer,
    input.taskDescription
  ]);
  const taskLane = selectTaskLanes(normalize(input.taskDescription))[0] ?? "bounded_coding_worker";
  const providerStatuses = Object.fromEntries(
    input.budgets.map((budget) => [budget.provider, budget.activeTierRateLimitState])
  ) as Readonly<Record<string, SubscriptionRateLimitState>>;
  const assignedProvider = selectModelForLayer(input.layer, providerStatuses);
  const assignedBudget = input.budgets.find((budget) => budget.provider === assignedProvider);
  const subscriptionBudgetState = assignedBudget?.activeTierRateLimitState ?? "unknown";
  const fallback = assignedBudget
    ? resolveFallback(
        subscriptionBudgetState === "rate_limited" ? "rate_limited" : "provider_unavailable",
        assignedProvider,
        assignedBudget
      )
    : undefined;
  const providerFamily = providerFamilyForReasoningProvider(assignedProvider);

  return {
    taskId: input.taskId,
    layer: input.layer,
    tokenEfficiencyProfile: tokenEfficiencyRoute.profile,
    contextWidthSpec,
    taskLane,
    assignedProvider,
    assignedTierId: assignedBudget?.activeTierId,
    subscriptionBudgetState,
    fallbackProvider: fallback?.toProvider ?? assignedProvider,
    learningSignal: deriveLearningSignal(input.layer, providerFamily, input.evalRecords),
    decisionReasoning: `Layer ${input.layer} maps to ${assignedProvider}; context width ${contextWidthSpec.budgetClass}; task lane ${taskLane}.`
  };
}

export function selectModelForLayer(
  layer: ModelPolicyLayer,
  providerStatuses: Readonly<Record<string, SubscriptionRateLimitState>>
): ReasoningProviderId {
  const provider = layerProviderMapping[layer];
  const state = providerStatuses[provider];

  if (provider === "gemini_cli" && (state === "rate_limited" || state === "exhausted")) {
    return "gemini_cli";
  }

  if (provider === "anthropic_claude_subscription" && (state === "rate_limited" || state === "exhausted")) {
    return "anthropic_claude_subscription";
  }

  return provider;
}

function selectTaskLanes(normalizedTask: string): ReasoningTaskLaneId[] {
  const matches = reasoningTaskLanePolicies
    .filter((lane) => hasAny(normalizedTask, lane.taskSignals))
    .map((lane) => lane.id);

  return matches.length > 0 ? unique(matches) : ["architecture_security_review"];
}

function selectProviderPolicies(taskLanes: readonly ReasoningTaskLaneId[]): ReasoningProviderId[] {
  return unique(
    taskLanes.flatMap((laneId) => {
      const lane = reasoningTaskLanePolicies.find((candidate) => candidate.id === laneId);
      return lane ? [...lane.preferredProviders] : [];
    })
  );
}

function selectAdvisoryProviders(
  normalizedTask: string,
  providerPolicies: readonly ReasoningProviderId[]
): readonly string[] {
  const providers = providerPolicies.filter((provider) => {
    if (provider === "anthropic_claude_subscription") {
      return hasAny(normalizedTask, ["claude", "anthropic", "subscription"]);
    }

    if (provider === "openai_gpt") {
      return hasAny(normalizedTask, ["openai", "gpt", "structured output", "function calling", "tool use"]);
    }

    if (provider === "deepseek_api_or_self_hosted") {
      return hasAny(normalizedTask, ["deepseek", "json", "function calling", "cost aware", "api", "self hosted"]);
    }

    if (provider === "deepseek_web_chat_manual") {
      return hasAny(normalizedTask, ["deepseek", "web chat", "web login", "manual", "quick", "expert", "free"]);
    }

    return provider === "gemini_cli" || provider === "qwen_local" || provider === "deterministic_tools";
  });

  const normalizedProviders = providers.length > 0 ? providers : providerPolicies;
  const advisoryProviders = normalizedProviders.map((provider) =>
    provider === "deterministic_tools" ? "local_deterministic_tools" : provider
  );

  if (advisoryProviders.includes("gemini_cli")) {
    return unique([
      ...advisoryProviders,
      "provider_neutral_subscription_or_free_advisory_model",
      "local_llm_when_available"
    ]);
  }

  return unique([...advisoryProviders, "local_llm_when_available"]);
}

function requiredChecksForProviders(providerIds: readonly ReasoningProviderId[]): string[] {
  return providerIds.flatMap((providerId) => {
    const provider = reasoningProviderPolicies.find((candidate) => candidate.id === providerId);
    return provider ? [...provider.requiredChecks] : [];
  });
}

function stopConditionsForProviders(providerIds: readonly ReasoningProviderId[]): string[] {
  return providerIds.flatMap((providerId) => {
    const provider = reasoningProviderPolicies.find((candidate) => candidate.id === providerId);
    return provider ? [...provider.stopConditions] : [];
  });
}

function requiredChecksForTaskLanes(taskLaneIds: readonly ReasoningTaskLaneId[]): string[] {
  return taskLaneIds.flatMap((laneId) => {
    const lane = reasoningTaskLanePolicies.find((candidate) => candidate.id === laneId);
    return lane ? [...lane.requiredChecks] : [];
  });
}

function stopConditionsForTaskLanes(taskLaneIds: readonly ReasoningTaskLaneId[]): string[] {
  return taskLaneIds.flatMap((laneId) => {
    const lane = reasoningTaskLanePolicies.find((candidate) => candidate.id === laneId);
    return lane ? [...lane.stopConditions] : [];
  });
}

function providerFamilyForReasoningProvider(provider: ReasoningProviderId): ModelProviderFamily {
  switch (provider) {
    case "openai_gpt":
      return "openai";
    case "anthropic_claude_subscription":
      return "anthropic";
    case "gemini_cli":
      return "google";
    case "qwen_local":
      return "qwen";
    case "deepseek_api_or_self_hosted":
    case "deepseek_web_chat_manual":
      return "deepseek";
    case "deterministic_tools":
      return "local";
  }
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function hasAny(normalizedTask: string, terms: readonly string[]): boolean {
  return terms.some((term) => normalizedTask.includes(normalize(term)));
}
