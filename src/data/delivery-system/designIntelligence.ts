export type DesignIntelligenceAgentId = "visual-analyst" | "design-critic";

export type DesignReviewMode =
  | "pre_production_analysis"
  | "post_production_critique"
  | "technology_research"
  | "architecture_library_review";

export type DesignVerdict = "pass" | "pass_with_notes" | "rework" | "reject";

export type ResearchProviderId =
  | "context7"
  | "official_docs"
  | "github_repository_search"
  | "hugging_face_docs"
  | "local_architecture_library";

export type LibraryCategory =
  | "agent_orchestration"
  | "typescript_ai_runtime"
  | "agent_ui"
  | "local_ai_interface"
  | "llm_evaluation"
  | "llm_observability"
  | "telemetry";

export type AdoptionStatus = "watch" | "candidate" | "pilot_only" | "avoid_for_now";

export interface DesignCritiqueCriterion {
  readonly id: string;
  readonly label: string;
  readonly question: string;
  readonly blockerSignals: readonly string[];
}

export interface ResearchProviderPolicy {
  readonly id: ResearchProviderId;
  readonly priority: number;
  readonly useFor: readonly string[];
  readonly availableInCurrentSession: boolean;
  readonly requiredChecks: readonly string[];
}

export interface ArchitectureLibraryCandidate {
  readonly id: string;
  readonly name: string;
  readonly category: LibraryCategory;
  readonly repository: string;
  readonly url: string;
  readonly license: string;
  readonly starsAtLastCheck: number;
  readonly lastChecked: string;
  readonly useFor: readonly string[];
  readonly adoptionStatus: AdoptionStatus;
  readonly risks: readonly string[];
}

export interface DesignIntelligencePolicy {
  readonly agents: readonly DesignIntelligenceAgentId[];
  readonly modes: readonly DesignReviewMode[];
  readonly sourceOfTruth: "typed_policy_and_review_packet";
  readonly requiredInputs: readonly string[];
  readonly requiredOutputs: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface DesignReviewRouteInput {
  readonly task: string;
}

export interface DesignReviewRouteResult {
  readonly agents: readonly DesignIntelligenceAgentId[];
  readonly modes: readonly DesignReviewMode[];
  readonly requiredInputs: readonly string[];
  readonly requiredOutputs: readonly string[];
  readonly criteria: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface ArchitectureLibrarySearchInput {
  readonly task: string;
}

export interface ArchitectureLibrarySearchResult {
  readonly providers: readonly ResearchProviderId[];
  readonly candidates: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export const designIntelligencePolicy = {
  agents: ["visual-analyst", "design-critic"],
  modes: [
    "pre_production_analysis",
    "post_production_critique",
    "technology_research",
    "architecture_library_review"
  ],
  sourceOfTruth: "typed_policy_and_review_packet",
  requiredInputs: [
    "project_goal",
    "target_audience",
    "visual_brief",
    "brand_constraints",
    "implementation_context",
    "reference_material",
    "performance_budget",
    "accessibility_requirements"
  ],
  requiredOutputs: [
    "analysis_packet",
    "critique_packet",
    "technology_recommendation",
    "risk_notes",
    "rework_requirements",
    "handoff_target"
  ],
  stopConditions: [
    "missing_visual_brief",
    "missing_target_audience",
    "missing_performance_budget",
    "missing_accessibility_requirements",
    "unverified_technology_claim",
    "gemini_claim_adopted_without_context7_or_official_docs",
    "license_unknown_for_adoption",
    "critic_is_same_actor_as_producer"
  ]
} as const satisfies DesignIntelligencePolicy;

export const designCritiqueRubric = [
  {
    id: "hierarchy",
    label: "Hierarchy",
    question: "Is the primary information visually dominant within the first scan?",
    blockerSignals: ["primary_action_unclear", "competing_focal_points", "important_content_buried"]
  },
  {
    id: "clarity",
    label: "Clarity",
    question: "Can the intended user understand what this visual does within three seconds?",
    blockerSignals: ["ambiguous_purpose", "unclear_state", "decorative_noise_over_signal"]
  },
  {
    id: "brand_fit",
    label: "Brand fit",
    question: "Does the visual language match the project and avoid generic AI aesthetics?",
    blockerSignals: ["generic_ai_style", "off_brand_palette", "inconsistent_visual_system"]
  },
  {
    id: "motion_value",
    label: "Motion value",
    question: "Does motion explain product, process, data, or state better than a static visual?",
    blockerSignals: ["motion_only_decoration", "motion_fatigue", "missing_static_equivalent"]
  },
  {
    id: "accessibility",
    label: "Accessibility",
    question: "Are contrast, readability, keyboard flow, reduced motion, and semantic content preserved?",
    blockerSignals: ["low_contrast", "text_in_canvas_only", "missing_reduced_motion"]
  },
  {
    id: "performance",
    label: "Performance",
    question: "Does the visual stay inside the agreed performance and mobile budget?",
    blockerSignals: ["performance_budget_missing", "mobile_jank", "oversized_asset"]
  },
  {
    id: "maintainability",
    label: "Maintainability",
    question: "Can the team edit, test, version, and hand off the visual without hidden tool debt?",
    blockerSignals: ["unversioned_asset_source", "proprietary_tool_lock_in", "missing_asset_manifest"]
  }
] as const satisfies readonly DesignCritiqueCriterion[];

export const researchProviderPolicies = [
  {
    id: "context7",
    priority: 1,
    useFor: [
      "current_library_docs",
      "framework_api_checks",
      "version_specific_guidance",
      "best_practice_verification",
      "gemini_claim_verification",
      "reasoning_brainstorm_verification"
    ],
    availableInCurrentSession: false,
    requiredChecks: ["fallback_when_unavailable", "record_context7_query_or_fallback", "cite_primary_docs"]
  },
  {
    id: "official_docs",
    priority: 2,
    useFor: ["framework_docs", "api_docs", "release_notes"],
    availableInCurrentSession: true,
    requiredChecks: ["cite_primary_docs", "check_current_date"]
  },
  {
    id: "github_repository_search",
    priority: 3,
    useFor: ["free_project_discovery", "license_review", "activity_review"],
    availableInCurrentSession: true,
    requiredChecks: ["license_check", "activity_check", "security_boundary_review"]
  },
  {
    id: "hugging_face_docs",
    priority: 4,
    useFor: ["models", "datasets", "spaces", "ml_tooling"],
    availableInCurrentSession: true,
    requiredChecks: ["model_license_check", "local_vs_cloud_boundary", "free_tier_or_no_cost_confirmed"]
  },
  {
    id: "local_architecture_library",
    priority: 5,
    useFor: ["approved_candidates", "prior_decisions", "internal_patterns"],
    availableInCurrentSession: true,
    requiredChecks: ["registry_status_check", "avoid_duplicate_source_of_truth"]
  }
] as const satisfies readonly ResearchProviderPolicy[];

export const architectureLibraryCandidates = [
  {
    id: "langgraph",
    name: "LangGraph",
    category: "agent_orchestration",
    repository: "langchain-ai/langgraph",
    url: "https://github.com/langchain-ai/langgraph",
    license: "MIT",
    starsAtLastCheck: 33373,
    lastChecked: "2026-05-30",
    useFor: ["stateful_agents", "human_in_the_loop", "durable_graph_workflows"],
    adoptionStatus: "candidate",
    risks: ["python_first_fit_review_needed", "avoid_duplicate_autopilot_mesh"]
  },
  {
    id: "mastra",
    name: "Mastra",
    category: "typescript_ai_runtime",
    repository: "mastra-ai/mastra",
    url: "https://github.com/mastra-ai/mastra",
    license: "NOASSERTION",
    starsAtLastCheck: 24546,
    lastChecked: "2026-05-30",
    useFor: ["typescript_agents", "workflows", "mcp_servers", "evals", "observability"],
    adoptionStatus: "watch",
    risks: ["dual_license_map_requires_review", "runtime_scope_not_approved"]
  },
  {
    id: "crewai",
    name: "CrewAI",
    category: "agent_orchestration",
    repository: "crewAIInc/crewAI",
    url: "https://github.com/crewAIInc/crewAI",
    license: "MIT",
    starsAtLastCheck: 52468,
    lastChecked: "2026-05-30",
    useFor: ["role_based_agents", "agent_crews", "python_automation"],
    adoptionStatus: "watch",
    risks: ["python_runtime_scope_review_needed", "do_not_replace_governance_roles_without_decision"]
  },
  {
    id: "vercel_ai_sdk",
    name: "Vercel AI SDK",
    category: "typescript_ai_runtime",
    repository: "vercel/ai",
    url: "https://github.com/vercel/ai",
    license: "NOASSERTION",
    starsAtLastCheck: 24546,
    lastChecked: "2026-05-30",
    useFor: ["provider_agnostic_generation", "structured_output", "agent_ui_streaming"],
    adoptionStatus: "candidate",
    risks: ["gateway_cost_boundary_free_tier_required", "license_file_review_required"]
  },
  {
    id: "open_webui",
    name: "Open WebUI",
    category: "local_ai_interface",
    repository: "open-webui/open-webui",
    url: "https://github.com/open-webui/open-webui",
    license: "NOASSERTION",
    starsAtLastCheck: 139254,
    lastChecked: "2026-05-30",
    useFor: ["local_llm_interface_reference", "ollama_ui_patterns", "rag_ui_reference"],
    adoptionStatus: "watch",
    risks: ["license_review_required", "do_not_vendor_large_runtime_into_autopilot"]
  },
  {
    id: "promptfoo",
    name: "Promptfoo",
    category: "llm_evaluation",
    repository: "promptfoo/promptfoo",
    url: "https://github.com/promptfoo/promptfoo",
    license: "MIT",
    starsAtLastCheck: 21717,
    lastChecked: "2026-05-30",
    useFor: ["prompt_evals", "agent_evals", "rag_tests", "red_teaming"],
    adoptionStatus: "candidate",
    risks: ["provider_keys_required_for_some_tests", "red_team_scope_requires_owner_decision"]
  },
  {
    id: "phoenix",
    name: "Arize Phoenix",
    category: "llm_observability",
    repository: "Arize-ai/phoenix",
    url: "https://github.com/Arize-ai/phoenix",
    license: "NOASSERTION",
    starsAtLastCheck: 9918,
    lastChecked: "2026-05-30",
    useFor: ["llm_tracing", "evals", "prompt_experiments", "observability_ui"],
    adoptionStatus: "watch",
    risks: ["deployment_surface_not_approved", "license_review_required"]
  },
  {
    id: "openinference",
    name: "OpenInference",
    category: "telemetry",
    repository: "Arize-ai/openinference",
    url: "https://github.com/Arize-ai/openinference",
    license: "Apache-2.0",
    starsAtLastCheck: 996,
    lastChecked: "2026-05-30",
    useFor: ["opentelemetry", "tracing", "opentelemetry_llm_tracing", "vendor_neutral_trace_schema"],
    adoptionStatus: "candidate",
    risks: ["instrumentation_scope_requires_runtime_decision"]
  }
] as const satisfies readonly ArchitectureLibraryCandidate[];

export function selectDesignReviewRoute(input: DesignReviewRouteInput): DesignReviewRouteResult {
  const normalizedTask = normalize(input.task);
  const needsResearch = hasAny(normalizedTask, [
    "research",
    "technology",
    "library",
    "github",
    "context7",
    "latest",
    "best practice",
    "best practices",
    "gemini",
    "brainstorm"
  ]);
  const needsCritique = hasAny(normalizedTask, ["review", "critic", "critique", "audit", "after", "evaluate"]);

  return {
    agents: needsCritique ? ["visual-analyst", "design-critic"] : ["visual-analyst"],
    modes: [
      "pre_production_analysis",
      ...(needsCritique ? (["post_production_critique"] as const) : []),
      ...(needsResearch ? (["technology_research", "architecture_library_review"] as const) : [])
    ],
    requiredInputs: designIntelligencePolicy.requiredInputs,
    requiredOutputs: designIntelligencePolicy.requiredOutputs,
    criteria: designCritiqueRubric.map((criterion) => criterion.id),
    stopConditions: designIntelligencePolicy.stopConditions
  };
}

export function searchArchitectureLibrary(input: ArchitectureLibrarySearchInput): ArchitectureLibrarySearchResult {
  const normalizedTask = normalize(input.task);
  const candidates = architectureLibraryCandidates.filter((candidate) =>
    candidate.useFor.some((signal) => containsTerm(normalizedTask, signal)) ||
    containsTerm(normalizedTask, candidate.id) ||
    containsTerm(normalizedTask, candidate.name)
  );
  const selected = candidates.length > 0 ? candidates : architectureLibraryCandidates.filter((candidate) =>
    candidate.adoptionStatus === "candidate"
  );

  return {
    providers: researchProviderPolicies
      .filter((provider) => provider.availableInCurrentSession)
      .sort((left, right) => left.priority - right.priority)
      .map((provider) => provider.id),
    candidates: selected.map((candidate) => candidate.id),
    requiredChecks: unique(researchProviderPolicies.flatMap((provider) => provider.requiredChecks)),
    stopConditions: [
      "context7_unavailable_without_fallback",
      "license_unknown_for_adoption",
      "runtime_scope_not_approved",
      "cloud_dependency_without_free_tier_confirmation",
      "paid_dependency_without_owner_exception"
    ]
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function hasAny(normalizedTask: string, terms: readonly string[]): boolean {
  return terms.some((term) => containsTerm(normalizedTask, term));
}

function containsTerm(normalizedTask: string, term: string): boolean {
  const normalizedTerm = normalize(term);

  if (normalizedTerm.includes(" ")) {
    return normalizedTask.includes(normalizedTerm);
  }

  return normalizedTask.split(/\s+/).includes(normalizedTerm);
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
