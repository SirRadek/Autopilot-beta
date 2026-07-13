import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  recordAutopilotIncident,
  type AutopilotIncident
} from "./incidentStore";
import { StateMaintenanceLockError } from "./stateMaintenanceLock";
import { redactTelemetryText } from "./telemetryRedaction";

export type OperationalIncidentStage =
  | "control_plane_status"
  | "control_plane_sessions"
  | "control_plane_workers"
  | "control_plane_providers"
  | "control_plane_observability"
  | "control_plane_approvals"
  | "control_plane_runs"
  | "supervisor_loop"
  | "provider_poll"
  | "worker_output"
  | "state_maintenance"
  | "state_recovery";

export interface OperationalIncidentInput {
  readonly stage: OperationalIncidentStage;
  readonly correlation_ids?: Readonly<Record<string, string>>;
}

const SPOOL_SUFFIX = "-incident-spool";
const CORRELATION_KEYS = new Set([
  "request_id",
  "provider",
  "worker_run_id",
  "handoff_id",
  "run_id",
  "session_id"
]);

export function recordOperationalIncident(
  stateDir: string,
  input: OperationalIncidentInput
): AutopilotIncident {
  const incidentId = randomUUID();
  const recordedAt = new Date().toISOString();
  const incidentInput = {
    severity: "high" as const,
    stage: input.stage,
    summary: `operational_failure:${input.stage}`,
    correlation_ids: boundedOperationalCorrelations(input.correlation_ids),
    impact: `operation_incomplete:${input.stage}`,
    retry_count: 0,
    event_refs: []
  };
  try {
    return recordAutopilotIncident(stateDir, incidentInput, { incidentId, recordedAt });
  } catch (error) {
    if (!(error instanceof StateMaintenanceLockError) || error.code !== "state_lock_timeout") throw error;
    const incident: AutopilotIncident = {
      ...incidentInput,
      incident_id: incidentId,
      recorded_at: recordedAt,
      status: "open",
      acknowledged_at: null,
      acknowledged_by: null
    };
    spoolOperationalIncident(stateDir, incident);
    return incident;
  }
}

function boundedOperationalCorrelations(
  correlations: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  if (correlations === undefined) return {};
  return Object.fromEntries(
    Object.entries(correlations)
      .filter(([key]) => CORRELATION_KEYS.has(key))
      .slice(0, CORRELATION_KEYS.size)
      .map(([key, value]) => [key, redactTelemetryText(String(value), 200)])
  );
}

function spoolOperationalIncident(stateDir: string, incident: AutopilotIncident): void {
  const directory = operationalIncidentSpoolDirectory(stateDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${incident.incident_id}.json`);
  const descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(incident)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function operationalIncidentSpoolDirectory(stateDir: string): string {
  const resolved = resolve(stateDir);
  return join(dirname(resolved), `.${basename(resolved)}${SPOOL_SUFFIX}`);
}
