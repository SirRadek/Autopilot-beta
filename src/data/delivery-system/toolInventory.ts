export type ToolInventoryStatus =
  | "session_callable"
  | "cached_not_session_callable"
  | "local_skill"
  | "provider_policy_only";

export type SkillSource = "platform_plugin" | "platform_skill" | "custom_local_skill";

export interface SkillCapabilitySpec {
  readonly taskCategories: readonly string[];
  readonly tokenCostClass: "high" | "medium" | "low" | "free";
  readonly requiresExternalAccess: boolean;
  readonly projectAware: boolean;
  readonly customizable: boolean;
}

export interface SkillUsageRecord {
  readonly skillId: string;
  readonly lastUsedAt: string;
  readonly sessionUseCount: number;
  readonly evalScoreAverage: number | undefined;
  readonly commonFailureLabels: readonly string[];
}

export interface SkillReplacementCandidate {
  readonly existingSkillId: string;
  readonly candidateId: string;
  readonly candidateSource: "custom_local_skill";
  readonly candidatePromptPath: string | undefined;
  readonly expectedBenefits: readonly string[];
  readonly evaluationCriteria: readonly string[];
  readonly status: "proposed" | "in_development" | "evaluating" | "adopted" | "rejected";
  readonly statusReason: string | undefined;
}

export interface SkillRegistrySnapshot {
  readonly lastUpdatedAt: string;
  readonly schemaVersion: "v1";
  readonly skills: readonly SkillCapabilitySpec[];
  readonly usageRecords: readonly SkillUsageRecord[];
  readonly replacementCandidates: readonly SkillReplacementCandidate[];
}

export interface ToolInventoryItem {
  readonly id: string;
  readonly title: string;
  readonly category: "plugin" | "skill_group" | "mcp_tool" | "model_provider";
  readonly status: ToolInventoryStatus;
  readonly source: string;
  readonly useFor: readonly string[];
  readonly activationRule: string;
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface ToolInventorySnapshot {
  readonly observedAt: string;
  readonly evidence: readonly string[];
  readonly rules: readonly string[];
  readonly items: readonly ToolInventoryItem[];
}

export interface ToolInventoryRouteInput {
  readonly task: string;
}

export interface ToolInventoryRouteResult {
  readonly matchingItems: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly notes: readonly string[];
}

export const toolInventorySnapshot = {
  observedAt: "2026-06-11",
  evidence: [
    "current_codex_session_plugin_list",
    "current_codex_session_skill_list",
    "local_plugin_cache_listing",
    "openai_codex_manual_agent_skills_plugins_mcp_sections",
    "deepseek_web_chat_quick_and_expert_smoke_tests_2026_06_11"
  ],
  rules: [
    "Use current session callable plugins before cached-only bundles.",
    "Do not claim a cached plugin is callable until it is surfaced by the active tools or tool_search.",
    "Use tool_search for deferred MCP tools when the task names a plugin capability.",
    "Use skills only after reading the relevant SKILL.md workflow.",
    "External connector or provider claims remain advisory until verified by local files, official docs, tests, or connector evidence.",
    "Model providers registered in policy are not callable tools unless a separate credentialed runtime or connector is verified."
  ],
  items: [
    {
      id: "browser_plugin",
      title: "Browser",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["local web inspection", "localhost testing", "screenshots", "click/type browser QA"],
      activationRule: "Use for explicit Browser requests or local web targets.",
      requiredChecks: ["known_local_target", "no_secret_capture", "browser_evidence_recorded"],
      stopConditions: ["unknown_external_target", "credentials_visible_in_browser"]
    },
    {
      id: "build_web_apps_plugin",
      title: "Build Web Apps",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["frontend implementation", "React guidance", "browser testing", "web app debugging"],
      activationRule: "Use relevant web-app skills for frontend build or test work.",
      requiredChecks: ["skill_workflow_read", "responsive_check", "accessibility_check"],
      stopConditions: ["design_scope_unclassified", "visual_claim_without_browser_evidence"]
    },
    {
      id: "github_plugin",
      title: "GitHub",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["repository issues", "pull requests", "CI triage", "publishing changes"],
      activationRule: "Use when GitHub state, CI, PRs, or issues are in scope.",
      requiredChecks: ["remote_mutation_scope_declared", "connector_state_verified", "no_secret_logging"],
      stopConditions: ["remote_mutation_without_approval", "unverified_ci_claim"]
    },
    {
      id: "figma_plugin",
      title: "Figma",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["design sync", "screens", "components", "FigJam diagrams", "Figma Slides"],
      activationRule: "Use for explicit Figma URLs or design generation/sync requests.",
      requiredChecks: ["product_design_os_scope_checked", "figma_context_verified", "asset_rights_checked"],
      stopConditions: ["design_scope_unclassified", "remote_mutation_without_approval"]
    },
    {
      id: "data_analytics_plugin",
      title: "Data Analytics",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["reports", "dashboards", "KPI analysis", "metric diagnostics"],
      activationRule: "Use artifact validation before report/dashboard rendering.",
      requiredChecks: ["bounded_snapshot", "source_metadata_declared", "artifact_validated_before_render"],
      stopConditions: ["unbounded_dataset_snapshot", "direct_personal_data_in_widget"]
    },
    {
      id: "cloudflare_plugin",
      title: "Cloudflare",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["Workers", "Agents SDK", "Durable Objects", "Wrangler", "Cloudflare APIs"],
      activationRule: "Use Cloudflare skills for Cloudflare platform work.",
      requiredChecks: ["official_docs_or_context7_verified", "account_mutation_scope_declared"],
      stopConditions: ["remote_mutation_without_approval", "secret_in_prompt"]
    },
    {
      id: "vercel_plugin",
      title: "Vercel",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["Next.js", "Vercel AI SDK", "deployments", "agent browser verification"],
      activationRule: "Use Vercel skills for Vercel platform or Next.js work when relevant.",
      requiredChecks: ["official_docs_or_context7_verified", "deployment_scope_declared"],
      stopConditions: ["remote_mutation_without_approval", "unverified_deployment_claim"]
    },
    {
      id: "hugging_face_plugin",
      title: "Hugging Face",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["model cards", "datasets", "Spaces", "community evals", "papers"],
      activationRule: "Use for Hugging Face Hub lookups, model cards, and ML job workflows.",
      requiredChecks: ["model_license_checked", "source_authority_recorded", "privacy_boundary_checked"],
      stopConditions: ["license_unverified", "private_data_not_redacted"]
    },
    {
      id: "product_design_plugin",
      title: "Product Design",
      category: "plugin",
      status: "session_callable",
      source: "current_session_plugins",
      useFor: ["product directions", "UX flows", "prototype review", "image-to-code"],
      activationRule: "Use for product/design ideation and prototype workflows after PDOS classification.",
      requiredChecks: ["product_design_os_scope_checked", "opposition_run", "acceptance_criteria_defined"],
      stopConditions: ["design_scope_unclassified", "conflict_with_goal_unresolved"]
    },
    {
      id: "deepseek_web_chat_manual",
      title: "DeepSeek Web Chat Manual Advisory",
      category: "model_provider",
      status: "provider_policy_only",
      source: "chat.deepseek.com controlled browser evidence and src/data/delivery-system/modelPolicy.ts",
      useFor: [
        "DeepSeek web chat",
        "free web-login advisory",
        "manual Quick mode second opinion",
        "manual Expert mode reasoning second opinion",
        "redacted prompt critique"
      ],
      activationRule:
        "Open https://chat.deepseek.com/ in the Browser plugin, verify logged-in chat without reading credentials, start a fresh chat, select Rychly or Expert before sending the full prompt, and treat the response as advisory only.",
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
        "model_output_used_as_source_of_truth"
      ]
    },
    {
      id: "deepseek_provider_policy",
      title: "DeepSeek",
      category: "model_provider",
      status: "provider_policy_only",
      source: "src/data/delivery-system/modelPolicy.ts",
      useFor: [
        "DeepSeek",
        "JSON output comparison",
        "reasoning model comparison",
        "function calling review",
        "cost-aware coding critique",
        "API or self-hosted advisory review"
      ],
      activationRule:
        "Route through select_reasoning_model_route; do not call DeepSeek until provider availability, cost or self-hosting, redaction, and official-doc checks pass.",
      requiredChecks: [
        "provider_availability_verified",
        "api_credit_or_self_hosting_cost_confirmed",
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
      ]
    },
    {
      id: "local_core_skills",
      title: "Local Core Skills",
      category: "skill_group",
      status: "local_skill",
      source: "current_session_skills",
      useFor: ["testing", "security", "systematic debugging", "Playwright", "docs", "Node.js", "Python"],
      activationRule: "Read the relevant local SKILL.md before applying the workflow.",
      requiredChecks: ["skill_workflow_read", "task_matches_skill", "local_verification_required"],
      stopConditions: ["skill_missing", "workflow_requires_unavailable_tool"]
    },
    {
      id: "cached_clickup_bundle",
      title: "ClickUp",
      category: "plugin",
      status: "cached_not_session_callable",
      source: "local_plugin_cache",
      useFor: ["potential project management integration"],
      activationRule: "Do not use unless a current session tool or tool_search exposes it.",
      requiredChecks: ["tool_search_confirms_callable", "connector_scope_declared"],
      stopConditions: ["cached_plugin_treated_as_callable"]
    },
    {
      id: "cached_shopify_bundle",
      title: "Shopify",
      category: "plugin",
      status: "cached_not_session_callable",
      source: "local_plugin_cache",
      useFor: ["potential ecommerce platform integration"],
      activationRule: "Do not use unless a current session tool or tool_search exposes it.",
      requiredChecks: ["tool_search_confirms_callable", "store_mutation_scope_declared"],
      stopConditions: ["cached_plugin_treated_as_callable", "remote_mutation_without_approval"]
    },
    {
      id: "cached_remotion_bundle",
      title: "Remotion",
      category: "plugin",
      status: "cached_not_session_callable",
      source: "local_plugin_cache",
      useFor: ["potential video generation workflows"],
      activationRule: "Do not use unless a current session tool or tool_search exposes it.",
      requiredChecks: ["tool_search_confirms_callable", "render_cost_checked"],
      stopConditions: ["cached_plugin_treated_as_callable"]
    },
    {
      id: "cached_openai_developers_bundle",
      title: "OpenAI Developers",
      category: "plugin",
      status: "cached_not_session_callable",
      source: "local_plugin_cache",
      useFor: ["potential OpenAI platform docs or API-key workflows"],
      activationRule: "Prefer the openai-docs skill and official docs unless this bundle is exposed as callable.",
      requiredChecks: ["tool_search_confirms_callable", "official_docs_verified"],
      stopConditions: ["cached_plugin_treated_as_callable", "secret_in_prompt"]
    }
  ]
} as const satisfies ToolInventorySnapshot;

export function selectToolInventoryForTask(input: ToolInventoryRouteInput): ToolInventoryRouteResult {
  const normalizedTask = normalize(input.task);
  const matchingItems = toolInventorySnapshot.items
    .filter((item) => itemMatchesTask(item, normalizedTask))
    .map((item) => item.id);
  const selectedItems =
    matchingItems.length > 0 ? matchingItems : ["local_core_skills"];

  return {
    matchingItems: selectedItems,
    requiredChecks: unique(selectedItems.flatMap((id) => requireInventoryItem(id).requiredChecks)),
    stopConditions: unique(selectedItems.flatMap((id) => requireInventoryItem(id).stopConditions)),
    notes: [
      "Session-callable plugins may be used through their exposed skills or MCP tools.",
      "Cached-only plugin bundles are evidence of local cache state, not callable capability.",
      "Provider-policy-only items are mesh routing records, not active credentials or runtime connectors.",
      "DeepSeek web chat is a manual browser-login advisory path, not a CLI, API runtime, or stable headless automation contract.",
      "Provider or plugin best-practice claims still require official documentation, local files, tests, or controlled evidence."
    ]
  };
}

function itemMatchesTask(item: ToolInventoryItem, normalizedTask: string): boolean {
  const haystack = normalize([item.id, item.title, ...item.useFor].join(" "));
  return haystack.split(" ").some((term) => term.length > 3 && normalizedTask.includes(term));
}

function requireInventoryItem(id: string): ToolInventoryItem {
  const item = toolInventorySnapshot.items.find((candidate) => candidate.id === id);

  if (!item) {
    throw new Error(`Tool inventory item not found: ${id}`);
  }

  return item;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
