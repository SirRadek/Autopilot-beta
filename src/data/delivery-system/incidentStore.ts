import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { redactTelemetryText } from "./telemetryRedaction";

const INCIDENT_STORE_FILE = "autopilot-incidents.json";
const MAX_INCIDENTS = 256;
const MAX_STORE_BYTES = 2 * 1024 * 1024;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_TEXT_CHARS = 2_000;
const MAX_ID_CHARS = 200;
const MAX_CORRELATION_IDS = 32;
const MAX_EVENT_REFS = 32;
const MAX_REPAIR_STEPS = 20;
const MAX_PACKET_BYTES = 64 * 1_024;
const MAX_PACKET_ITEM_CHARS = 512;

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "acknowledged";

export interface AutopilotIncidentInput {
  readonly severity: IncidentSeverity;
  readonly stage: string;
  readonly summary: string;
  readonly correlation_ids: Readonly<Record<string, string>>;
  readonly impact: string;
  readonly retry_count: number;
  readonly event_refs: readonly string[];
}

export interface AutopilotIncident extends AutopilotIncidentInput {
  readonly incident_id: string;
  readonly recorded_at: string;
  readonly status: IncidentStatus;
  readonly acknowledged_at: string | null;
  readonly acknowledged_by: string | null;
}

export interface IncidentStoreDocument {
  readonly schema_version: "v1";
  readonly incidents: readonly AutopilotIncident[];
}

export interface RepairPacketInput {
  readonly expected: string;
  readonly actual: string;
  readonly reproduction_steps?: readonly string[];
  readonly verification_commands?: readonly string[];
}

export interface AutopilotRepairPacket {
  readonly schema_version: "v1";
  readonly intent: "external_autopilot_repair";
  readonly execution: "manual";
  readonly incident: AutopilotIncident;
  readonly expected: string;
  readonly actual: string;
  readonly reproduction_steps: readonly string[];
  readonly verification_commands: readonly string[];
}

export function readIncidentStore(stateDir: string): IncidentStoreDocument {
  const path = join(stateDir, INCIDENT_STORE_FILE);
  if (!existsSync(path)) return { schema_version: "v1", incidents: [] };
  if (statSync(path).size > MAX_STORE_BYTES) throw new Error("invalid_incident_store");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("invalid_incident_store");
  }
  validateDocument(parsed);
  return parsed;
}

export function recordAutopilotIncident(stateDir: string, input: AutopilotIncidentInput): AutopilotIncident {
  const document = readIncidentStore(stateDir);
  const incident: AutopilotIncident = {
    incident_id: randomUUID(),
    recorded_at: new Date().toISOString(),
    status: "open",
    acknowledged_at: null,
    acknowledged_by: null,
    severity: requireSeverity(input.severity),
    stage: boundedText(input.stage, MAX_ID_CHARS),
    summary: boundedText(input.summary, MAX_SUMMARY_CHARS),
    correlation_ids: boundedCorrelationIds(input.correlation_ids),
    impact: boundedText(input.impact, MAX_TEXT_CHARS),
    retry_count: boundedRetryCount(input.retry_count),
    event_refs: boundedTextList(input.event_refs, MAX_EVENT_REFS, MAX_ID_CHARS)
  };
  writeIncidentStore(stateDir, { schema_version: "v1", incidents: [...document.incidents, incident].slice(-MAX_INCIDENTS) });
  return incident;
}

export function acknowledgeIncident(stateDir: string, incidentId: string, owner: string): AutopilotIncident {
  const document = readIncidentStore(stateDir);
  const index = document.incidents.findIndex((incident) => incident.incident_id === incidentId);
  if (index < 0) throw new Error("incident_not_found");
  const current = document.incidents[index] as AutopilotIncident;
  const acknowledged: AutopilotIncident = {
    ...current,
    status: "acknowledged",
    acknowledged_at: current.acknowledged_at ?? new Date().toISOString(),
    acknowledged_by: current.acknowledged_by ?? boundedText(owner, MAX_ID_CHARS)
  };
  const incidents = [...document.incidents];
  incidents[index] = acknowledged;
  writeIncidentStore(stateDir, { schema_version: "v1", incidents });
  return acknowledged;
}

export function prepareRepairPacket(stateDir: string, incidentId: string, input: RepairPacketInput): AutopilotRepairPacket {
  const incident = readIncidentStore(stateDir).incidents.find((candidate) => candidate.incident_id === incidentId);
  if (incident === undefined) throw new Error("incident_not_found");
  const packet: AutopilotRepairPacket = {
    schema_version: "v1",
    intent: "external_autopilot_repair",
    execution: "manual",
    incident,
    expected: boundedText(input.expected, MAX_TEXT_CHARS),
    actual: boundedText(input.actual, MAX_TEXT_CHARS),
    reproduction_steps: boundedTextList(input.reproduction_steps ?? [], MAX_REPAIR_STEPS, MAX_PACKET_ITEM_CHARS),
    verification_commands: boundedTextList(input.verification_commands ?? [], MAX_REPAIR_STEPS, MAX_PACKET_ITEM_CHARS)
  };
  if (Buffer.byteLength(JSON.stringify(packet), "utf8") > MAX_PACKET_BYTES) throw new Error("repair_packet_too_large");
  return packet;
}

function writeIncidentStore(stateDir: string, document: IncidentStoreDocument): void {
  validateDocument(document);
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, INCIDENT_STORE_FILE);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) throw new Error("invalid_incident_store");
  try {
    writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function validateDocument(value: unknown): asserts value is IncidentStoreDocument {
  if (!isExactRecord(value, ["schema_version", "incidents"]) || value.schema_version !== "v1" || !Array.isArray(value.incidents) || value.incidents.length > MAX_INCIDENTS) {
    throw new Error("invalid_incident_store");
  }
  const ids = new Set<string>();
  for (const incident of value.incidents) {
    if (!isIncident(incident) || ids.has(incident.incident_id)) throw new Error("invalid_incident_store");
    ids.add(incident.incident_id);
  }
}

function isIncident(value: unknown): value is AutopilotIncident {
  if (!isExactRecord(value, ["incident_id", "recorded_at", "status", "acknowledged_at", "acknowledged_by", "severity", "stage", "summary", "correlation_ids", "impact", "retry_count", "event_refs"])) return false;
  if (!boundedString(value.incident_id, MAX_ID_CHARS) || !boundedString(value.recorded_at, MAX_ID_CHARS) || !["open", "acknowledged"].includes(value.status as string) || !["low", "medium", "high", "critical"].includes(value.severity as string)) return false;
  if (!boundedString(value.stage, MAX_ID_CHARS) || !boundedString(value.summary, MAX_SUMMARY_CHARS) || !boundedString(value.impact, MAX_TEXT_CHARS)) return false;
  if (![value.stage, value.summary, value.impact].every(isRedacted)) return false;
  if (!Number.isInteger(value.retry_count) || (value.retry_count as number) < 0 || (value.retry_count as number) > 1_000) return false;
  if (!nullableBoundedString(value.acknowledged_at, MAX_ID_CHARS) || !nullableBoundedString(value.acknowledged_by, MAX_ID_CHARS)) return false;
  if (value.acknowledged_by !== null && !isRedacted(value.acknowledged_by)) return false;
  if (value.status === "open" && (value.acknowledged_at !== null || value.acknowledged_by !== null)) return false;
  if (value.status === "acknowledged" && (value.acknowledged_at === null || value.acknowledged_by === null)) return false;
  if (!isBoundedStringRecord(value.correlation_ids) || !isBoundedStringList(value.event_refs, MAX_EVENT_REFS, MAX_ID_CHARS)) return false;
  return true;
}

function isBoundedStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_CORRELATION_IDS && entries.every(([key, item]) => key.length > 0 && key.length <= MAX_ID_CHARS && boundedString(item, MAX_ID_CHARS) && isRedacted(key) && isRedacted(item));
}

function boundedCorrelationIds(value: Readonly<Record<string, string>>): Record<string, string> {
  if (!isRecord(value)) throw new Error("invalid_incident");
  return Object.fromEntries(Object.entries(value).slice(0, MAX_CORRELATION_IDS).map(([key, item]) => [boundedText(key, MAX_ID_CHARS), boundedText(String(item), MAX_ID_CHARS)]));
}

function boundedTextList(value: readonly string[], count: number, chars: number): string[] {
  if (!Array.isArray(value)) throw new Error("invalid_incident");
  return value.slice(0, count).map((item) => boundedText(item, chars));
}

function isBoundedStringList(value: unknown, count: number, chars: number): value is string[] {
  return Array.isArray(value) && value.length <= count && value.every((item) => boundedString(item, chars) && isRedacted(item));
}

function boundedText(value: string, chars: number): string {
  if (typeof value !== "string") throw new Error("invalid_incident");
  const redacted = redactTelemetryText(value, chars);
  if (Buffer.byteLength(redacted, "utf8") <= chars) return redacted;
  let end = redacted.length;
  while (end > 0 && Buffer.byteLength(redacted.slice(0, end), "utf8") > chars) end -= 1;
  return redacted.slice(0, end);
}

function isRedacted(value: string): boolean {
  return redactTelemetryText(value, value.length) === value;
}

function requireSeverity(value: IncidentSeverity): IncidentSeverity {
  if (!["low", "medium", "high", "critical"].includes(value)) throw new Error("invalid_incident");
  return value;
}

function boundedRetryCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error("invalid_incident");
  return Math.min(value, 1_000);
}

function boundedString(value: unknown, chars: number): value is string {
  return typeof value === "string" && value.length <= chars;
}

function nullableBoundedString(value: unknown, chars: number): value is string | null {
  return value === null || boundedString(value, chars);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
