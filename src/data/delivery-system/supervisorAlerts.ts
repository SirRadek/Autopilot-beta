export type AlertSeverity = "info" | "warning" | "blocker";

export type AlertTrigger =
  | "provider_rate_limited"
  | "provider_tier_switched"
  | "provider_unavailable"
  | "correction_loop_exceeded"
  | "stuck_workflow_state"
  | "eval_score_below_threshold"
  | "missing_owner_decision"
  | "gemini_session_exhausted"
  | "reuse_check_skipped"
  | "skill_replacement_available";

export interface SupervisorAlert {
  readonly id: string;
  readonly trigger: AlertTrigger;
  readonly severity: AlertSeverity;
  readonly provider: string | null;
  readonly context: string;
  readonly recommendedAction: string;
  readonly createdAt: string;
  readonly resolved: boolean;
  readonly resolvedAt: string | null;
}

const SEVERITY_MAP: Record<AlertTrigger, AlertSeverity> = {
  provider_rate_limited: "warning",
  provider_tier_switched: "info",
  provider_unavailable: "blocker",
  correction_loop_exceeded: "blocker",
  stuck_workflow_state: "warning",
  eval_score_below_threshold: "warning",
  missing_owner_decision: "blocker",
  gemini_session_exhausted: "warning",
  reuse_check_skipped: "info",
  skill_replacement_available: "info"
};

const RECOMMENDED_ACTION_MAP: Record<AlertTrigger, string> = {
  provider_rate_limited: "Record the capacity event and wait or choose an approved fallback tier.",
  provider_tier_switched: "Record the provider tier change in the session state.",
  provider_unavailable: "Stop dependent work and mark the provider path as blocked or waiting_owner.",
  correction_loop_exceeded: "Stop correction attempts and request supervisor review.",
  stuck_workflow_state: "Review the workflow state and define the next explicit transition.",
  eval_score_below_threshold: "Route the output through review before reuse.",
  missing_owner_decision: "Wait for the required owner decision before continuing.",
  gemini_session_exhausted: "Record the exhausted Gemini session and consider an approved Gemini fallback tier.",
  reuse_check_skipped: "Run the reuse check before assigning bounded implementation.",
  skill_replacement_available: "Review the replacement candidate before continuing with the older skill."
};

let alertSequence = 0;

export function createAlert(trigger: AlertTrigger, context: string, provider: string | null = null): SupervisorAlert {
  alertSequence += 1;

  return {
    id: `alert-${trigger.replaceAll("_", "-")}-${alertSequence}`,
    trigger,
    severity: SEVERITY_MAP[trigger],
    provider,
    context,
    recommendedAction: RECOMMENDED_ACTION_MAP[trigger],
    createdAt: new Date().toISOString(),
    resolved: false,
    resolvedAt: null
  };
}

export function resolveAlert(alert: SupervisorAlert): SupervisorAlert {
  return {
    ...alert,
    resolved: true,
    resolvedAt: new Date().toISOString()
  };
}
