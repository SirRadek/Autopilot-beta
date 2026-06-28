export interface ModelSpendPolicy {
  readonly providerDependency: "provider_neutral";
  readonly lowCostWorkerUse: readonly string[];
  readonly longContextResearchUse: readonly string[];
  readonly creativeReviewUse: readonly string[];
  readonly freeCloudAdvisoryUse: readonly string[];
  readonly subscriptionInteractiveUse: readonly string[];
  readonly manualWebAdvisoryUse: readonly string[];
  readonly apiOrSelfHostedUse: readonly string[];
  readonly repoExecutorUse: readonly string[];
  readonly advisoryHierarchy: readonly string[];
  readonly frontierOnlyWhen: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
}

export const modelSpendPolicy = {
  providerDependency: "provider_neutral",
  lowCostWorkerUse: [
    "bulk_summarization",
    "seo_drafts",
    "data_cleanup_plans",
    "document_reconstruction_drafts",
    "task_packet_generation",
    "first_pass_code",
    "classification"
  ],
  longContextResearchUse: [
    "long_context_research",
    "brainstorming_variants",
    "market_research",
    "document_understanding",
    "broad_planning"
  ],
  creativeReviewUse: ["design_review", "ux_critique", "creative_direction", "architecture_critique"],
  freeCloudAdvisoryUse: [
    "brainstorming",
    "architecture_second_opinion",
    "design_critique",
    "security_critique",
    "planning_critique",
    "agent_validation",
    "research_synthesis"
  ],
  subscriptionInteractiveUse: [
    "gemini_cli_google_ai_subscription_advisory",
    "claude_code_architecture_second_opinion",
    "claude_code_security_critique",
    "claude_code_planning_critique",
    "claude_code_agent_validation",
    "bounded_interactive_repo_session_after_owner_scope"
  ],
  manualWebAdvisoryUse: [
    "deepseek_web_chat_manual_second_opinion",
    "deepseek_quick_mode_low_latency_advice",
    "deepseek_expert_mode_reasoning_advice"
  ],
  apiOrSelfHostedUse: [
    "openai_structured_outputs",
    "openai_tool_orchestration",
    "deepseek_json_or_reasoning_comparison",
    "deepseek_self_hosted_candidate",
    "hosted_provider_review_after_cost_decision"
  ],
  repoExecutorUse: ["repo_editing", "tests", "refactors", "debugging", "patch_workflow"],
  advisoryHierarchy: [
    "deterministic_local_evidence_over_model_output",
    "claude_code_subscription_high_trust_broad_repo_read_after_owner_scope",
    "openai_gpt_high_trust_structured_or_deep_reasoning_after_cost_or_entitlement_check",
    "gemini_cli_standard_advisory_redacted_context_after_subscription_check",
    "qwen_local_bounded_draft_requires_review",
    "deepseek_web_chat_manual_advisory_after_login_and_mode_check",
    "deepseek_comparison_only_after_cost_or_self_hosting_check"
  ],
  frontierOnlyWhen: [
    "high_risk",
    "ambiguous",
    "architecture_level",
    "security_sensitive",
    "repeated_failure",
    "final_review"
  ],
  requiredChecks: [
    "provider_availability_verified",
    "provider_run_status_recorded",
    "model_output_presence_verified",
    "free_tier_or_no_cost_confirmed",
    "subscription_entitlement_confirmed_for_subscription_tools",
    "google_ai_subscription_entitlement_confirmed_for_gemini_cli",
    "advisory_trust_hierarchy_applied",
    "claude_broad_read_scope_owner_scoped",
    "lower_trust_advisor_claims_verified_before_adoption",
    "model_output_evaluation_before_model_change",
    "repeated_failure_evidence_before_model_switch",
    "api_credit_or_self_hosting_cost_confirmed",
    "authentication_state_verified_without_token_disclosure",
    "controlled_browser_evidence_required",
    "fresh_chat_started_for_each_mode_test",
    "prompt_packet_bounded",
    "redacted_context_only",
    "context7_or_official_docs_verified",
    "gemini_brainstorm_claims_labeled_and_verified",
    "owner_cost_decision_for_credentialed_provider",
    "factual_claims_verified",
    "smallest_safe_model_class",
    "disclose_model_choice_when_risk_affects_delivery"
  ],
  stopConditions: [
    "provider_availability_unverified",
    "provider_run_failed_without_blocked_state",
    "model_output_missing_from_artifact",
    "advisory_workflow_continued_after_provider_error",
    "non_local_worker_dependency",
    "cloud_model_for_routine_worker_loop",
    "frontier_used_for_simple_worker_task",
    "model_choice_affects_risk_without_disclosure",
    "paid_model_or_credit_required",
    "paid_model_or_credit_required_without_owner_decision",
    "subscription_entitlement_unverified",
    "google_ai_subscription_entitlement_unverified",
    "api_credit_path_requested_without_owner_decision",
    "gemini_api_key_or_paid_api_path_requested_without_owner_decision",
    "authentication_missing",
    "browser_session_unavailable",
    "mode_switch_unverified",
    "technology_claim_without_context7_or_official_docs",
    "gemini_claim_adopted_without_verification",
    "lower_trust_model_overrides_claude_without_verified_evidence",
    "model_changed_without_eval_evidence",
    "reasoning_effort_increased_without_failure_pattern"
  ]
} as const satisfies ModelSpendPolicy;
