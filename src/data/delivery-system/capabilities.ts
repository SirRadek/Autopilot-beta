export type CapabilityModuleId =
  | "web_build_mesh"
  | "optimization_mesh"
  | "data_mesh"
  | "seo_mesh"
  | "automation_mesh"
  | "recovery_mesh"
  | "observability_mesh"
  | "document_mesh"
  | "bot_rag_mesh"
  | "three_d_experience_addon";

export type CapabilityPositioning = "primary_service" | "supporting_service" | "premium_addon";

export interface CapabilityModule {
  readonly id: CapabilityModuleId;
  readonly title: string;
  readonly positioning: CapabilityPositioning;
  readonly useFor: readonly string[];
  readonly signals: readonly string[];
  readonly requiredAgents: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly avoidWhen?: readonly string[];
}

export interface CapabilityRoutingRule {
  readonly id: string;
  readonly signals: readonly string[];
  readonly activate: readonly CapabilityModuleId[];
  readonly optional?: readonly CapabilityModuleId[];
  readonly avoid?: readonly CapabilityModuleId[];
  readonly reason: string;
}

export interface CapabilitySelectionInput {
  readonly task: string;
}

export interface CapabilitySelectionResult {
  readonly task: string;
  readonly activate: readonly CapabilityModuleId[];
  readonly optional: readonly CapabilityModuleId[];
  readonly avoid: readonly CapabilityModuleId[];
  readonly requiredAgents: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly reason: readonly string[];
}

export interface CapabilitySourceOfTruth {
  readonly canonical: "mesh_yaml";
  readonly executableMirror: "typescript_routing_index";
  readonly driftCheck: "capability_ids_signals_agents_checks_match_mesh_yaml";
}

export interface ParallelSystemPolicy {
  readonly currentPath: "extend_existing_autopilot_mesh";
  readonly futureOption: "parallel_ai_production_studio";
  readonly allowedWhen: readonly string[];
  readonly forbiddenNow: readonly string[];
  readonly stopConditions: readonly string[];
}

export const capabilityModules = [
  {
    id: "web_build_mesh",
    title: "Web Build Mesh",
    positioning: "primary_service",
    useFor: ["landing_page", "company_website", "portfolio", "web_application", "client_portal", "admin_panel"],
    signals: ["website", "landing", "web app", "frontend", "company website", "portfolio", "portal", "admin"],
    requiredAgents: ["web_architect", "frontend", "seo_performance", "qa"],
    requiredChecks: ["responsive_check", "accessibility_check", "seo_metadata_check", "speed_check", "mobile_check"]
  },
  {
    id: "optimization_mesh",
    title: "Optimization Mesh",
    positioning: "primary_service",
    useFor: ["page_speed", "core_web_vitals", "conversion_path", "ux_friction", "database_bottlenecks"],
    signals: ["slow", "performance", "optimize", "core web vitals", "conversion", "ux friction", "caching", "bottleneck"],
    requiredAgents: ["seo_performance", "frontend", "backend_database", "qa"],
    requiredChecks: ["baseline_metric", "target_metric", "backup", "rollback_plan", "performance_check"]
  },
  {
    id: "data_mesh",
    title: "Data Mesh",
    positioning: "primary_service",
    useFor: ["database_design", "data_cleaning", "migration", "csv_xlsx_processing", "reports", "dashboards"],
    signals: ["data", "database", "csv", "xlsx", "migration", "duplicate", "schema", "report"],
    requiredAgents: ["data_processing", "backend_database", "qa"],
    requiredChecks: ["preserve_original", "infer_schema", "validate_data", "transformation_log", "backup"]
  },
  {
    id: "seo_mesh",
    title: "SEO Mesh",
    positioning: "primary_service",
    useFor: ["technical_audit", "content_structure", "migration_recovery", "local_business", "ecommerce_categories"],
    signals: ["seo", "index", "metadata", "canonical", "sitemap", "schema", "broken links", "local seo"],
    requiredAgents: ["seo_performance", "frontend", "content", "qa"],
    requiredChecks: ["titles", "descriptions", "headings", "canonical", "robots", "sitemap", "indexability"]
  },
  {
    id: "automation_mesh",
    title: "Automation Mesh",
    positioning: "primary_service",
    useFor: ["email_automation", "form_to_database", "crm_sync", "api_integrations", "notifications", "reporting"],
    signals: ["automation", "workflow", "crm", "google sheets", "api integration", "notifications", "scraping", "monitoring"],
    requiredAgents: ["automation", "backend_database", "qa"],
    requiredChecks: ["process_mapping", "retry_policy", "error_logging", "manual_override", "test_data"]
  },
  {
    id: "recovery_mesh",
    title: "Recovery Mesh",
    positioning: "primary_service",
    useFor: ["broken_website", "hacked_website", "failed_migration", "seo_drop", "plugin_conflict"],
    signals: [
      "recovery",
      "rescue",
      "broken website",
      "hacked",
      "failed migration",
      "lost content",
      "seo drop",
      "wordpress"
    ],
    requiredAgents: ["qa_recovery", "security", "seo_performance", "backend_database"],
    requiredChecks: [
      "backup_current_state",
      "validate_backup_before_rotation",
      "verify_runtime_write_boundary",
      "identify_platform",
      "crawl_current_site",
      "scan_basic_security"
    ]
  },
  {
    id: "observability_mesh",
    title: "Observability Mesh",
    positioning: "supporting_service",
    useFor: [
      "runtime_logs",
      "diagnostics",
      "bottleneck_localization",
      "error_triage",
      "performance_tracing",
      "incident_evidence"
    ],
    signals: [
      "log",
      "logs",
      "logging",
      "runtime logs",
      "observability",
      "diagnostic",
      "diagnostics",
      "trace",
      "tracing",
      "error",
      "bottleneck",
      "bottlenecks",
      "problem",
      "problems",
      "monitoring",
      "incident",
      "request id",
      "deploy log",
      "ci log",
      "runtime log",
      "control plane",
      "advisory model run",
      "provider run",
      "runner log",
      "cli error",
      "cli syntax error",
      "missing model output",
      "no model output",
      "prompt only"
    ],
    requiredAgents: ["architect", "qa", "frontend", "backend_database", "seo_performance", "security"],
    requiredChecks: [
      "problem_scope_classified",
      "autopilot_vs_project_boundary",
      "project_slug_or_control_plane_identified",
      "provider_run_status_recorded",
      "runner_artifact_contract_verified",
      "model_output_presence_verified",
      "log_window_defined",
      "source_inventory",
      "redacted_log_summary",
      "correlation_id_or_fallback",
      "baseline_metric",
      "suspect_layer_identified",
      "reproduction_or_counterexample",
      "fix_verification"
    ]
  },
  {
    id: "document_mesh",
    title: "Document Mesh",
    positioning: "supporting_service",
    useFor: ["document_reconstruction", "pdf_extraction", "ocr", "information_cleanup", "structured_export"],
    signals: ["document", "pdf", "ocr", "scan", "reconstruction", "extract", "digitize"],
    requiredAgents: ["data_processing", "qa"],
    requiredChecks: ["preserve_original", "mark_uncertain_values", "validate_extraction", "export_review"]
  },
  {
    id: "bot_rag_mesh",
    title: "Bot / RAG Mesh",
    positioning: "supporting_service",
    useFor: ["knowledge_base", "faq_bot", "internal_assistant", "rag", "document_bot"],
    signals: ["bot", "rag", "knowledge base", "faq", "assistant", "retrieval", "chat"],
    requiredAgents: ["automation", "data_processing", "security", "qa"],
    requiredChecks: ["source_grounding", "private_data_boundary", "fallback_to_human", "answer_policy"]
  },
  {
    id: "three_d_experience_addon",
    title: "3D Experience Add-on",
    positioning: "premium_addon",
    useFor: ["premium_landing_page", "product_storytelling", "interactive_visualization", "scroll_story"],
    signals: ["3d", "webgl", "r3f", "three", "animation", "product reveal", "scroll storytelling", "interactive visual"],
    requiredAgents: ["design_ux", "frontend", "seo_performance", "qa"],
    requiredChecks: [
      "performance_budget",
      "mobile_fallback",
      "reduced_motion_support",
      "seo_content_outside_canvas"
    ],
    avoidWhen: [
      "seo_content_page",
      "low_budget_website",
      "performance_is_primary_problem",
      "mobile_first_simple_site",
      "client_needs_easy_cms_editing"
    ]
  }
] as const satisfies readonly CapabilityModule[];

export const capabilityRoutingRules = [
  {
    id: "observability_diagnostics",
    signals: [
      "log",
      "logs",
      "runtime logs",
      "logging",
      "observability",
      "diagnostic",
      "diagnostics",
      "trace",
      "tracing",
      "error",
      "bottleneck",
      "bottlenecks",
      "problem",
      "problems",
      "monitoring",
      "incident",
      "advisory model run",
      "provider run",
      "runner log",
      "cli error",
      "cli syntax error",
      "missing model output",
      "no model output",
      "prompt only"
    ],
    activate: ["observability_mesh"],
    optional: ["optimization_mesh", "recovery_mesh", "automation_mesh", "data_mesh"],
    avoid: ["three_d_experience_addon"],
    reason: "Classify Autopilot-vs-project ownership first, then inspect redacted evidence for the narrowest failing layer."
  },
  {
    id: "slow_website",
    signals: ["slow", "performance", "core web vitals", "broken links", "seo issues", "optimize"],
    activate: ["optimization_mesh", "seo_mesh"],
    optional: ["data_mesh"],
    avoid: ["three_d_experience_addon"],
    reason: "Measure first, then optimize against a target metric."
  },
  {
    id: "new_business_website",
    signals: ["new website", "landing page", "company website", "portfolio", "web app"],
    activate: ["web_build_mesh", "seo_mesh"],
    optional: ["automation_mesh", "three_d_experience_addon"],
    reason: "New web surfaces need content structure, SEO basics, responsive UX, and deployment gates."
  },
  {
    id: "data_cleanup",
    signals: ["data", "database", "csv", "xlsx", "migration", "duplicate", "schema"],
    activate: ["data_mesh"],
    optional: ["document_mesh"],
    avoid: ["three_d_experience_addon"],
    reason: "Data work must preserve originals, infer schema, validate transforms, and keep a change log."
  },
  {
    id: "automation_workflow",
    signals: ["automation", "workflow", "crm", "google sheets", "api integration", "notifications"],
    activate: ["automation_mesh"],
    optional: ["data_mesh", "bot_rag_mesh"],
    reason: "Automation work needs mapped inputs, outputs, failure points, logging, alerts, and manual override."
  },
  {
    id: "website_rescue",
    signals: ["recovery", "rescue", "broken website", "hacked", "failed migration", "lost content", "seo drop"],
    activate: ["recovery_mesh", "optimization_mesh", "seo_mesh"],
    avoid: ["three_d_experience_addon"],
    reason: "Recovery starts with backup, diagnosis, platform checks, crawl, and risk-first repair planning."
  },
  {
    id: "knowledge_bot",
    signals: ["bot", "rag", "knowledge base", "faq", "assistant", "retrieval"],
    activate: ["bot_rag_mesh", "data_mesh"],
    optional: ["automation_mesh"],
    reason: "Knowledge bots need grounded sources, answer policy, privacy boundaries, and escalation."
  },
  {
    id: "document_reconstruction",
    signals: ["document", "pdf", "ocr", "scan", "reconstruction", "extract", "digitize"],
    activate: ["document_mesh", "data_mesh"],
    reason: "Document reconstruction must preserve originals and mark uncertain extraction results."
  },
  {
    id: "premium_3d_experience",
    signals: ["3d", "webgl", "r3f", "animation", "product reveal", "scroll storytelling"],
    activate: ["web_build_mesh", "three_d_experience_addon"],
    optional: ["optimization_mesh"],
    reason: "3D is useful only when it explains product, process, data, or system state."
  }
] as const satisfies readonly CapabilityRoutingRule[];

export const capabilitySourceOfTruth = {
  canonical: "mesh_yaml",
  executableMirror: "typescript_routing_index",
  driftCheck: "capability_ids_signals_agents_checks_match_mesh_yaml"
} as const satisfies CapabilitySourceOfTruth;

export const parallelSystemPolicy = {
  currentPath: "extend_existing_autopilot_mesh",
  futureOption: "parallel_ai_production_studio",
  allowedWhen: [
    "explicit_architecture_decision",
    "existing_mesh_limits_are_documented",
    "migration_or_interop_plan_exists",
    "owner_accepts_added_maintenance_cost"
  ],
  forbiddenNow: [
    "create_unscoped_parallel_runtime",
    "duplicate_decision_sources",
    "replace_project_mesh_lifecycle_without_decision",
    "move_routine_worker_loops_to_cloud_by_default"
  ],
  stopConditions: [
    "parallel_system_without_decision",
    "conflicting_sources_of_truth",
    "unbounded_new_runtime_scope"
  ]
} as const satisfies ParallelSystemPolicy;

export function selectCapabilityModules(input: CapabilitySelectionInput): CapabilitySelectionResult {
  const normalizedTask = normalize(input.task);
  const matchedRules: readonly CapabilityRoutingRule[] = capabilityRoutingRules.filter((rule) =>
    rule.signals.some((signal) => containsTerm(normalizedTask, signal))
  );
  if (matchedRules.length === 0) {
    return {
      task: input.task,
      activate: [],
      optional: [],
      avoid: [],
      requiredAgents: [],
      requiredChecks: [],
      reason: [
        "No capability signals matched. Return a neutral routing result and ask for bounded context if implementation cannot continue."
      ]
    };
  }

  const rules: readonly CapabilityRoutingRule[] = matchedRules;
  const activate = uniqueCapabilities(rules.flatMap((rule) => rule.activate));
  const optional = uniqueCapabilities(rules.flatMap((rule) => rule.optional ?? []));
  const avoid = uniqueCapabilities(rules.flatMap((rule) => rule.avoid ?? []));
  const activeModules = activate.map(requireCapabilityModule);

  return {
    task: input.task,
    activate,
    optional,
    avoid,
    requiredAgents: uniqueStrings(activeModules.flatMap((module) => module.requiredAgents)),
    requiredChecks: uniqueStrings(activeModules.flatMap((module) => module.requiredChecks)),
    reason: uniqueStrings(rules.map((rule) => rule.reason))
  };
}

function requireCapabilityModule(id: CapabilityModuleId): CapabilityModule {
  const module = capabilityModules.find((candidate) => candidate.id === id);

  if (!module) {
    throw new Error(`Capability module not found: ${id}`);
  }

  return module;
}

function uniqueCapabilities(values: readonly CapabilityModuleId[]): CapabilityModuleId[] {
  return [...new Set(values)];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, " ");
}

function containsTerm(normalizedTask: string, term: string): boolean {
  const normalizedTerm = normalize(term);

  if (normalizedTerm.includes(" ")) {
    return normalizedTask.includes(normalizedTerm);
  }

  return normalizedTask.split(/\s+/).includes(normalizedTerm);
}
