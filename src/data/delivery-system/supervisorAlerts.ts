import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  createInitialSessionState,
  SESSION_STATE_PATH,
  type SessionStateManifest
} from "./sessionState";

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
  | "skill_replacement_available"
  | "empty_output"
  | "non_zero_exit"
  | "auth_error"
  | "invalid_json"
  | "timeout"
  | "already_locked"
  | "lock_stale_replaced";

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
  skill_replacement_available: "info",
  empty_output: "blocker",
  non_zero_exit: "blocker",
  auth_error: "blocker",
  invalid_json: "blocker",
  timeout: "blocker",
  already_locked: "warning",
  lock_stale_replaced: "warning"
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
  skill_replacement_available: "Review the replacement candidate before continuing with the older skill.",
  empty_output: "Treat the worker run as failed and inspect the captured artifacts before reuse.",
  non_zero_exit: "Treat the worker run as failed and inspect the CLI exit status before reuse.",
  auth_error: "Stop dependent worker dispatch until the provider authentication state is repaired.",
  invalid_json: "Reject the structured worker result and rerun or repair the schema path before reuse.",
  timeout: "Treat the worker run as failed and decide whether to retry with a bounded timeout.",
  already_locked: "Wait for the active worker to finish or clear the stale lock after validation.",
  lock_stale_replaced: "Review the replaced stale lock and confirm no duplicate worker is still running."
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

export function writePendingSupervisorAlert(alert: SupervisorAlert, stateDir: string): void {
  const path = stateFilePath(stateDir, SESSION_STATE_PATH);
  mkdirSync(dirname(path), { recursive: true });

  const state = readSessionStateForAlerts(path);
  const nextState: SessionStateManifest = {
    ...state,
    lastUpdatedAt: alert.createdAt,
    pendingAlerts: [...state.pendingAlerts, alert]
  };

  writeFileSync(path, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

function readSessionStateForAlerts(path: string): SessionStateManifest {
  if (!existsSync(path)) {
    return createInitialSessionState();
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SessionStateManifest>;
    const fallback = createInitialSessionState();

    return {
      ...fallback,
      ...parsed,
      pendingAlerts: Array.isArray(parsed.pendingAlerts) ? parsed.pendingAlerts : fallback.pendingAlerts
    } as SessionStateManifest;
  } catch {
    return createInitialSessionState();
  }
}

function stateFilePath(stateDir: string, path: string): string {
  const fileName = path.split(/[\\/]/).at(-1) ?? path;
  return join(stateDir, fileName);
}
