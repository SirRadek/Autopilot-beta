export type PromptLibraryProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "qwen"
  | "deepseek"
  | "dair_ai"
  | "github_catalog"
  | "local";

export type PromptLibraryRoute =
  | "provider_guidance"
  | "local_prompt_library"
  | "local_worker_prompt"
  | "advisory_brainstorm_prompt"
  | "manual_web_advisory_prompt"
  | "plugin_asset_library_prompt"
  | "github_control_surface_prompt"
  | "role_scope_prompt"
  | "prompt_eval_required";

export interface PromptLibraryPolicy {
  readonly sourceOfTruth: "local_git_markdown_library";
  readonly authorityOrder: readonly string[];
  readonly approvedReferenceProviders: readonly PromptLibraryProvider[];
  readonly requiredMetadata: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly forbiddenSources: readonly string[];
  readonly meshApplicationPhases: readonly PromptMeshApplicationPhase[];
}

export interface PromptMeshApplicationPhase {
  readonly id: string;
  readonly goal: string;
  readonly deliverables: readonly string[];
  readonly acceptanceChecks: readonly string[];
}

export interface PromptLibraryRouteInput {
  readonly task: string;
}

export interface PromptLibraryRouteResult {
  readonly route: PromptLibraryRoute;
  readonly providers: readonly PromptLibraryProvider[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly notes: readonly string[];
}

export const promptLibraryPolicy = {
  sourceOfTruth: "local_git_markdown_library",
  authorityOrder: [
    "official_provider_docs",
    "local_autopilot_policy_and_mesh",
    "local_evals_and_verified_outputs",
    "dair_ai_and_github_catalogs_as_inspiration",
    "optional_prompt_management_tool_docs"
  ],
  approvedReferenceProviders: [
    "openai",
    "anthropic",
    "google",
    "qwen",
    "deepseek",
    "dair_ai",
    "github_catalog",
    "local"
  ],
  requiredMetadata: [
    "id",
    "title",
    "model_family",
    "task_type",
    "version",
    "status",
    "last_reviewed",
    "sources",
    "risk_level",
    "expected_output",
    "evals"
  ],
  requiredChecks: [
    "official_provider_docs_verified",
    "source_authority_recorded",
    "prompt_metadata_complete",
    "model_family_declared",
    "prompt_eval_defined",
    "model_output_eval_recorded_before_prompt_change",
    "prompt_or_input_delta_recorded",
    "weekly_eval_records_required_for_batch_tuning",
    "uncertainty_behavior_defined",
    "output_validation_defined",
    "role_scope_declared",
    "token_efficiency_route_selected",
    "plugin_capability_verified",
    "github_task_normalized",
    "asset_or_library_source_verified",
    "redacted_context_only",
    "version_change_logged",
    "rollback_path_exists"
  ],
  stopConditions: [
    "leaked_system_prompt_used",
    "prompt_without_source_authority",
    "prompt_without_eval",
    "prompt_change_without_model_output_eval_record",
    "prompt_rerun_without_delta",
    "weekly_prompt_tuning_without_eval_records",
    "model_specific_prompt_used_cross_model_without_review",
    "unverified_prompt_library_adopted",
    "prompt_changes_without_version",
    "role_without_scope",
    "plugin_invoked_without_availability_check",
    "raw_github_issue_used_as_prompt",
    "asset_or_library_without_source_review",
    "private_secret_in_prompt",
    "model_output_used_as_source_of_truth",
    "paid_prompt_management_tool_required"
  ],
  forbiddenSources: [
    "leaked_system_prompts",
    "unverified_social_media_prompt_packs",
    "private_prompts_without_permission",
    "model_output_as_prompt_authority",
    "undated_prompt_library_without_evals"
  ],
  meshApplicationPhases: [
    {
      id: "phase_0_foundation",
      goal: "Create the local prompt library and source catalog without runtime dependency.",
      deliverables: ["prompt-library/README.md", "prompt-library/prompt.schema.json", "prompt-library/source-catalog.md"],
      acceptanceChecks: ["files_exist", "metadata_contract_defined", "forbidden_sources_defined"]
    },
    {
      id: "phase_1_mesh_boundary",
      goal: "Route prompt selection through existing model, token, and capability governance.",
      deliverables: ["mesh/nodes/prompt_library_policy.yaml", "project prompt_library_boundary node", "mesh edges and rules"],
      acceptanceChecks: ["mesh_generate_passes", "route_mentions_prompt_library", "no_parallel_runtime"]
    },
    {
      id: "phase_2_validation",
      goal: "Add deterministic metadata validation before prompts can become defaults.",
      deliverables: ["prompt metadata validator", "prompt eval fixtures", "policy tests"],
      acceptanceChecks: ["metadata_complete", "evals_present", "forbidden_sources_rejected"]
    },
    {
      id: "phase_3_runtime_adoption",
      goal: "Adopt selected prompts into agent packets only after validation and rollback path exist.",
      deliverables: ["prompt selector", "agent packet references", "work-log prompt version records"],
      acceptanceChecks: ["prompt_version_pinned", "rollback_documented", "local_tests_pass"]
    }
  ]
} as const satisfies PromptLibraryPolicy;

export function selectPromptLibraryRoute(input: PromptLibraryRouteInput): PromptLibraryRouteResult {
  const normalizedTask = normalize(input.task);

  if (
    hasAny(normalizedTask, [
      "plugin",
      "connector",
      "mcp",
      "figma",
      "canva",
      "github app",
      "library",
      "asset",
      "ui kit",
      "icon",
      "font",
      "model asset"
    ])
  ) {
    return buildRoute("plugin_asset_library_prompt", ["local", "github_catalog"], [
      "Plugin, connector, library, and asset prompts need availability, cost, privacy, license, and scope checks.",
      "Do not adopt a package or asset without source and usage-rights review."
    ]);
  }

  if (hasAny(normalizedTask, ["github issue", "github pr", "pull request", "project board", "review request"])) {
    return buildRoute("github_control_surface_prompt", ["local"], [
      "Normalize GitHub issues, PRs, comments, and project cards into bounded task contracts before execution.",
      "Decision Mesh and local verification remain routing authority."
    ]);
  }

  if (hasAny(normalizedTask, ["qwen", "local worker", "ollama", "coder 7b", "coder 14b"])) {
    return buildRoute("local_worker_prompt", ["qwen", "local"], [
      "Use small, explicit, bounded prompts for local worker drafts.",
      "Local worker output needs supervisor review and deterministic tests."
    ]);
  }

  if (hasAny(normalizedTask, ["role", "agent", "orchestrator", "design critic", "visual analyst", "worker", "scope"])) {
    return buildRoute("role_scope_prompt", ["local"], [
      "Every role prompt needs mode, allowed files or surfaces, forbidden actions, expected output, and verification.",
      "Workers cannot approve their own output or change scope without evidence."
    ]);
  }

  if (hasAny(normalizedTask, ["deepseek web", "deepseek chat", "web login", "quick mode", "expert mode"])) {
    return buildRoute("manual_web_advisory_prompt", ["deepseek", "local"], [
      "DeepSeek web-chat prompts use prompt-library/07-deepseek/manual-web-advisory.md.",
      "Start a fresh chat, select Quick or Expert before sending, and keep the packet tiny and redacted.",
      "DeepSeek web output is advisory only and must be normalized before any local verification."
    ]);
  }

  if (hasAny(normalizedTask, ["gemini", "brainstorm", "variant", "creative critique", "second opinion"])) {
    return buildRoute("advisory_brainstorm_prompt", ["google", "local"], [
      "Gemini prompts are advisory only and must use redacted context.",
      "Ideas need Context7, official docs, local files, tests, or controlled evidence before adoption."
    ]);
  }

  if (hasAny(normalizedTask, ["eval", "evaluate", "regression", "version", "rollback", "prompt management"])) {
    return buildRoute("prompt_eval_required", ["local"], [
      "Prompt changes need metadata, eval fixtures, versioning, and rollback."
    ]);
  }

  if (hasAny(normalizedTask, ["openai", "gpt", "codex", "claude", "anthropic", "qwen", "gemini", "deepseek"])) {
    return buildRoute("provider_guidance", ["openai", "anthropic", "google", "qwen", "deepseek"], [
      "Provider-specific behavior must be verified against official provider documentation."
    ]);
  }

  return buildRoute("local_prompt_library", ["local", "dair_ai", "github_catalog"], [
    "Use the local Git/Markdown prompt library as the working source of truth.",
    "Use DAIR.AI and GitHub prompt catalogs only as inspiration."
  ]);
}

function buildRoute(
  route: PromptLibraryRoute,
  providers: readonly PromptLibraryProvider[],
  notes: readonly string[]
): PromptLibraryRouteResult {
  return {
    route,
    providers,
    requiredChecks: promptLibraryPolicy.requiredChecks,
    stopConditions: promptLibraryPolicy.stopConditions,
    notes
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function hasAny(normalizedTask: string, terms: readonly string[]): boolean {
  return terms.some((term) => normalizedTask.includes(normalize(term)));
}
