import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { readManagedStateTextFile } from "./managedStateFile";
import type { BrainstormRecord, BrainstormStage } from "./brainstormStore";
import type { RunRecord } from "./runStore";
import { withStateMaintenanceLock, writeStateFileAtomically } from "./stateMaintenanceLock";

export type BrainstormTelemetryLifecycle = "created" | "fanout_completed" | "consolidated" | "arbitrated" | "failed" | "cancelled";

export interface BrainstormTelemetryEvent {
  readonly schema_version: "v1";
  readonly event: BrainstormTelemetryLifecycle;
  readonly brainstorm_id: string;
  readonly provider_count: number;
  readonly material_conflict_count: number;
  readonly estimated_tokens: number;
  readonly actual_tokens: number | null;
  readonly duration_ms: number | null;
  readonly at: string;
}

export interface BrainstormTelemetryDocument {
  readonly schema_version: "v1";
  readonly events: readonly BrainstormTelemetryEvent[];
}

const FILE = "brainstorm-telemetry.json";
const MAX_STORE_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 256 * 6;
const EVENT_KEYS = ["schema_version", "event", "brainstorm_id", "provider_count", "material_conflict_count", "estimated_tokens", "actual_tokens", "duration_ms", "at"] as const;
const EVENTS = new Set<BrainstormTelemetryLifecycle>(["created", "fanout_completed", "consolidated", "arbitrated", "failed", "cancelled"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export function readBrainstormTelemetry(stateDir: string): BrainstormTelemetryDocument {
  let value: unknown;
  try {
    const file = readManagedStateTextFile(join(stateDir, FILE), { maxBytes: MAX_STORE_BYTES });
    if (file.status === "missing") return { schema_version: "v1", events: [] };
    value = JSON.parse(file.text);
  } catch {
    throw new Error("invalid_brainstorm_telemetry_store");
  }
  if (!isDocument(value)) throw new Error("invalid_brainstorm_telemetry_store");
  return value;
}

export function buildBrainstormTelemetryEvent(
  brainstorm: BrainstormRecord,
  runs: readonly RunRecord[],
  event: BrainstormTelemetryLifecycle,
  at: string,
): BrainstormTelemetryEvent {
  const requiredRunIds = requiredRunIdsFor(brainstorm, event);
  const actualTokens = event === "created" ? null : sumSettledTokens(requiredRunIds, runs);
  const started = Date.parse(brainstorm.created_at);
  const ended = Date.parse(at);
  const duration = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : null;
  const telemetry: BrainstormTelemetryEvent = {
    schema_version: "v1",
    event,
    brainstorm_id: brainstorm.brainstorm_id,
    provider_count: brainstorm.routes.length,
    material_conflict_count: brainstorm.conflicts.filter((conflict) => conflict.material).length,
    estimated_tokens: brainstorm.token_envelope.maximum_tokens,
    actual_tokens: actualTokens,
    duration_ms: duration,
    at,
  };
  if (!isEvent(telemetry)) throw new Error("invalid_brainstorm_telemetry");
  return telemetry;
}

export function recordBrainstormTelemetryEvent(stateDir: string, event: BrainstormTelemetryEvent): BrainstormTelemetryEvent {
  if (!isEvent(event)) throw new Error("invalid_brainstorm_telemetry");
  return withStateMaintenanceLock(stateDir, () => {
    const document = readBrainstormTelemetry(stateDir);
    const existing = document.events.find((candidate) => candidate.brainstorm_id === event.brainstorm_id && candidate.event === event.event);
    if (existing !== undefined) {
      if (!isDeepStrictEqual(existing, event)) throw new Error("brainstorm_telemetry_conflict");
      return existing;
    }
    if (document.events.length >= MAX_EVENTS) throw new Error("brainstorm_telemetry_limit");
    const next: BrainstormTelemetryDocument = { schema_version: "v1", events: [...document.events, event] };
    writeDocument(stateDir, next);
    return event;
  });
}

export function recordBrainstormTelemetryLifecycle(
  stateDir: string,
  brainstorm: BrainstormRecord,
  runs: readonly RunRecord[],
  event: BrainstormTelemetryLifecycle,
  at: string,
): BrainstormTelemetryEvent {
  return withStateMaintenanceLock(stateDir, () => {
    const document = readBrainstormTelemetry(stateDir);
    const existing = document.events.find((candidate) => candidate.brainstorm_id === brainstorm.brainstorm_id && candidate.event === event);
    if (existing !== undefined) return existing;
    const telemetry = buildBrainstormTelemetryEvent(brainstorm, runs, event, at);
    if (document.events.length >= MAX_EVENTS) throw new Error("brainstorm_telemetry_limit");
    writeDocument(stateDir, { schema_version: "v1", events: [...document.events, telemetry] });
    return telemetry;
  });
}

function requiredRunIdsFor(brainstorm: BrainstormRecord, event: BrainstormTelemetryLifecycle): readonly string[] {
  if (event === "created") return [];
  const stages = requiredStages(event);
  return [...new Set(brainstorm.slots
    .filter((slot) => stages.has(slot.stage) && slot.run_id !== null)
    .map((slot) => slot.run_id!))];
}

function requiredStages(event: BrainstormTelemetryLifecycle): ReadonlySet<BrainstormStage> {
  if (event === "fanout_completed") return new Set(["fanout"]);
  if (event === "consolidated") return new Set(["fanout", "consolidation"]);
  if (event === "arbitrated") return new Set(["fanout", "consolidation", "arbitration"]);
  return new Set(["fanout", "consolidation", "arbitration"]);
}

function sumSettledTokens(requiredRunIds: readonly string[], runs: readonly RunRecord[]): number | null {
  let total = 0;
  for (const runId of requiredRunIds) {
    const matching = runs.find((run) => run.current.run_id === runId);
    if (matching === undefined || matching.token_settlement === null) return null;
    const tokens = matching.token_settlement.totalTokens;
    if (!safeNonnegativeInteger(tokens) || total > Number.MAX_SAFE_INTEGER - tokens) return null;
    total += tokens;
  }
  return total;
}

function writeDocument(stateDir: string, document: BrainstormTelemetryDocument): void {
  if (!isDocument(document)) throw new Error("invalid_brainstorm_telemetry_store");
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) throw new Error("invalid_brainstorm_telemetry_store");
  writeStateFileAtomically(stateDir, join(stateDir, FILE), serialized);
}

function isDocument(value: unknown): value is BrainstormTelemetryDocument {
  if (!exactObject(value, ["schema_version", "events"]) || value.schema_version !== "v1" || !Array.isArray(value.events) || value.events.length > MAX_EVENTS) return false;
  const keys = new Set<string>();
  return value.events.every((event) => {
    if (!isEvent(event)) return false;
    const key = `${event.brainstorm_id}\0${event.event}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function isEvent(value: unknown): value is BrainstormTelemetryEvent {
  return exactObject(value, EVENT_KEYS) && value.schema_version === "v1" && EVENTS.has(value.event as BrainstormTelemetryLifecycle) &&
    typeof value.brainstorm_id === "string" && SAFE_ID.test(value.brainstorm_id) &&
    safeNonnegativeInteger(value.provider_count) && value.provider_count >= 3 && value.provider_count <= 4 &&
    safeNonnegativeInteger(value.material_conflict_count) && value.material_conflict_count <= 256 &&
    safeNonnegativeInteger(value.estimated_tokens) &&
    (value.actual_tokens === null || safeNonnegativeInteger(value.actual_tokens)) &&
    (value.duration_ms === null || safeNonnegativeInteger(value.duration_ms)) && validTimestamp(value.at);
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
