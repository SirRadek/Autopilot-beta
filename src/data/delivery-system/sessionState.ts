import type { HandoffId } from "./checkCompletionMatrix";
import type { SupervisorAlert } from "./supervisorAlerts";
import type { WorkflowState } from "./workflows";

export interface SessionStateManifest {
  readonly schemaVersion: "v1";
  readonly claudeSessionStartedAt: string;
  readonly lastUpdatedAt: string;
  readonly activeHandoffId: HandoffId | null;
  readonly workflowState: WorkflowState;
  readonly pendingAlerts: readonly SupervisorAlert[];
  readonly activeCorrectionLoopCount: number;
  readonly providerStatus: Readonly<Record<string, "available" | "rate_limited" | "unknown">>;
  readonly hookEventCount: number;
  readonly investigationQueueDepth: number;
  readonly supervisorSessionHash: string | null;
}

export interface SessionHistoryEntry {
  readonly timestamp: string;
  readonly event:
    | "session_start"
    | "handoff_created"
    | "worker_output_received"
    | "correction_loop_iteration"
    | "alert_created"
    | "alert_resolved"
    | "provider_status_changed"
    | "workflow_state_changed";
  readonly handoffId: HandoffId | null;
  readonly detail: string;
}

export const SESSION_STATE_PATH = "docs/autopilot/session-state/session.json";
export const SESSION_HISTORY_PATH = "docs/autopilot/session-state/history.jsonl";
export const SESSION_LOCK_PATH = "docs/autopilot/session-state/worker.lock";
export const AGENT_REGISTRY_PATH = "docs/autopilot/session-state/agent-registry.jsonl";
export const AGENT_HANDOFF_INDEX_PATH = "docs/autopilot/session-state/agent-handoff-index.jsonl";
export const SUBAGENT_EVIDENCE_PATH = "docs/autopilot/session-state/subagent-evidence.jsonl";
export const HISTORY_MAX_ENTRIES = 50;

export function createInitialSessionState(): SessionStateManifest {
  const now = new Date().toISOString();

  return {
    schemaVersion: "v1",
    claudeSessionStartedAt: now,
    lastUpdatedAt: now,
    activeHandoffId: null,
    workflowState: "planning",
    pendingAlerts: [],
    activeCorrectionLoopCount: 0,
    providerStatus: {},
    hookEventCount: 0,
    investigationQueueDepth: 0,
    supervisorSessionHash: null
  };
}

export function createHistoryEntry(
  event: SessionHistoryEntry["event"],
  detail: string,
  handoffId?: HandoffId
): SessionHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    event,
    handoffId: handoffId ?? null,
    detail
  };
}
