import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  recordAutopilotIncident,
  readIncidentStore,
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
const MAX_SPOOL_FILES = 256;
const MAX_SPOOL_FILE_BYTES = 16 * 1024;
const INCIDENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

export function ingestOperationalIncidentSpool(stateDir: string): number {
  const directory = operationalIncidentSpoolDirectory(stateDir);
  if (!existsSync(directory)) return 0;
  let ingested = 0;
  for (const name of readdirSync(directory).sort().slice(0, MAX_SPOOL_FILES)) {
    const path = join(directory, name);
    let incident: AutopilotIncident | null = null;
    try {
      const status = lstatSync(path);
      if (!status.isFile() || status.isSymbolicLink() || status.size > MAX_SPOOL_FILE_BYTES) continue;
      incident = parseSpooledOperationalIncident(readFileSync(path, "utf8"), name);
    } catch {
      continue;
    }
    if (incident === null) continue;
    if (readIncidentStore(stateDir).incidents.some((candidate) => candidate.incident_id === incident.incident_id)) {
      unlinkSync(path);
      continue;
    }
    recordAutopilotIncident(stateDir, {
      severity: incident.severity,
      stage: incident.stage,
      summary: incident.summary,
      correlation_ids: incident.correlation_ids,
      impact: incident.impact,
      retry_count: incident.retry_count,
      event_refs: incident.event_refs
    }, {
      incidentId: incident.incident_id,
      recordedAt: incident.recorded_at
    });
    unlinkSync(path);
    ingested += 1;
  }
  return ingested;
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

function parseSpooledOperationalIncident(bytes: string, name: string): AutopilotIncident | null {
  try {
    const value = JSON.parse(bytes) as unknown;
    if (!isRecord(value)
      || typeof value.incident_id !== "string"
      || !INCIDENT_ID_PATTERN.test(value.incident_id)
      || name !== `${value.incident_id}.json`
      || typeof value.recorded_at !== "string"
      || !Number.isFinite(Date.parse(value.recorded_at))
      || value.status !== "open"
      || value.acknowledged_at !== null
      || value.acknowledged_by !== null
      || value.severity !== "high"
      || !isOperationalIncidentStage(value.stage)
      || value.summary !== `operational_failure:${value.stage}`
      || value.impact !== `operation_incomplete:${value.stage}`
      || value.retry_count !== 0
      || !Array.isArray(value.event_refs)
      || value.event_refs.length !== 0
      || !isStringRecord(value.correlation_ids)) return null;
    const correlations = boundedOperationalCorrelations(value.correlation_ids);
    if (JSON.stringify(correlations) !== JSON.stringify(value.correlation_ids)) return null;
    return value as unknown as AutopilotIncident;
  } catch {
    return null;
  }
}

function isOperationalIncidentStage(value: unknown): value is OperationalIncidentStage {
  return typeof value === "string" && [
    "control_plane_status",
    "control_plane_sessions",
    "control_plane_workers",
    "control_plane_providers",
    "control_plane_observability",
    "control_plane_approvals",
    "control_plane_runs",
    "supervisor_loop",
    "provider_poll",
    "worker_output",
    "state_maintenance",
    "state_recovery"
  ].includes(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
