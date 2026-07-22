import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { estimateBrainstormTokenEnvelope, type BrainstormTokenEnvelope } from "./brainstormBudget";
import type { RunReasoningEffort } from "./executionProfile";
import { readManagedStateTextFile } from "./managedStateFile";
import type { RunProvider } from "./runStore";
import { withStateMaintenanceLock, writeStateFileAtomically } from "./stateMaintenanceLock";

export type BrainstormStatus = "draft" | "approved" | "fanout_running" | "consolidating" | "needs_arbitration" | "arbitrating" | "completed" | "failed" | "cancelled";

export interface BrainstormRoute {
  readonly provider: RunProvider;
  readonly model: string;
  readonly reasoning_effort: RunReasoningEffort;
  readonly estimated_tokens: number;
}

export interface BrainstormConflict {
  readonly conflict_id: string;
  readonly output_run_ids: readonly [string, string];
  readonly summary: string;
  readonly material: boolean;
}

export interface BrainstormRecord {
  readonly schema_version: "v1";
  readonly brainstorm_id: string;
  readonly project_id: string;
  readonly brief: string;
  readonly routes: readonly BrainstormRoute[];
  readonly synthesizer_route: BrainstormRoute;
  readonly arbitration_route: BrainstormRoute | null;
  readonly token_envelope: BrainstormTokenEnvelope;
  readonly child_run_ids: readonly string[];
  readonly consolidation_run_id: string | null;
  readonly arbitration_run_id: string | null;
  readonly conflicts: readonly BrainstormConflict[];
  readonly final_artifact: string | null;
  readonly status: BrainstormStatus;
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BrainstormStoreDocument {
  readonly schema_version: "v1";
  readonly brainstorms: readonly BrainstormRecord[];
}

export type BrainstormCreateInput = Pick<BrainstormRecord,
  "project_id" | "brief" | "routes" | "synthesizer_route" | "arbitration_route" | "token_envelope">;

const FILE = "brainstorms.json";
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const MAX_BRAINSTORMS = 256;
const MAX_BRIEF_CHARS = 32_000;
const MAX_MODEL_CHARS = 256;
const MAX_ID_CHARS = 256;
const MAX_CONFLICTS = 256;
const MAX_CONFLICT_SUMMARY_CHARS = 32_000;
const MAX_FINAL_ARTIFACT_CHARS = 64_000;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PROVIDERS = new Set<RunProvider>(["codex_cli", "claude_cli", "agy_cli", "openrouter_api"]);
const REASONING_EFFORTS = new Set<RunReasoningEffort>(["low", "medium", "high", "xhigh", "max"]);
const STATUSES = new Set<BrainstormStatus>(["draft", "approved", "fanout_running", "consolidating", "needs_arbitration", "arbitrating", "completed", "failed", "cancelled"]);
const INPUT_KEYS = ["project_id", "brief", "routes", "synthesizer_route", "arbitration_route", "token_envelope"] as const;
const RECORD_KEYS = ["schema_version", "brainstorm_id", "project_id", "brief", "routes", "synthesizer_route", "arbitration_route", "token_envelope", "child_run_ids", "consolidation_run_id", "arbitration_run_id", "conflicts", "final_artifact", "status", "approved_by", "created_at", "updated_at"] as const;
const ROUTE_KEYS = ["provider", "model", "reasoning_effort", "estimated_tokens"] as const;
const CONFLICT_KEYS = ["conflict_id", "output_run_ids", "summary", "material"] as const;
const ENVELOPE_KEYS = ["fanout_tokens", "consolidation_tokens", "optional_arbitration_tokens", "minimum_tokens", "maximum_tokens"] as const;

export function readBrainstormStore(stateDir: string): BrainstormStoreDocument {
  const path = join(stateDir, FILE);
  let document: unknown;
  try {
    const file = readManagedStateTextFile(path, { maxBytes: MAX_STORE_BYTES });
    if (file.status === "missing") return { schema_version: "v1", brainstorms: [] };
    document = JSON.parse(file.text);
  } catch {
    throw new Error("invalid_brainstorm_store");
  }
  if (!isBrainstormStoreDocument(document)) throw new Error("invalid_brainstorm_store");
  return document;
}

export function createBrainstorm(
  stateDir: string,
  input: BrainstormCreateInput,
  createdAt: string,
): BrainstormRecord {
  assertCreateInput(input);
  if (!validTimestamp(createdAt)) throw new Error("invalid_brainstorm");
  return withStateMaintenanceLock(stateDir, () => {
    const document = readBrainstormStore(stateDir);
    if (document.brainstorms.length >= MAX_BRAINSTORMS) throw new Error("brainstorm_limit");
    const record: BrainstormRecord = {
      schema_version: "v1",
      brainstorm_id: randomUUID(),
      project_id: input.project_id,
      brief: input.brief,
      routes: input.routes.map(copyRoute),
      synthesizer_route: copyRoute(input.synthesizer_route),
      arbitration_route: input.arbitration_route === null ? null : copyRoute(input.arbitration_route),
      token_envelope: { ...input.token_envelope },
      child_run_ids: [],
      consolidation_run_id: null,
      arbitration_run_id: null,
      conflicts: [],
      final_artifact: null,
      status: "draft",
      approved_by: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    writeBrainstormStore(stateDir, { schema_version: "v1", brainstorms: [...document.brainstorms, record] });
    return record;
  });
}

export function replaceBrainstorm(stateDir: string, record: BrainstormRecord): BrainstormRecord {
  if (!isBrainstormRecord(record)) throw new Error("invalid_brainstorm");
  return withStateMaintenanceLock(stateDir, () => {
    const document = readBrainstormStore(stateDir);
    const index = document.brainstorms.findIndex((candidate) => candidate.brainstorm_id === record.brainstorm_id);
    if (index < 0) throw new Error("brainstorm_not_found");
    const existing = document.brainstorms[index] as BrainstormRecord;
    if (!sameImmutableFields(existing, record)) throw new Error("brainstorm_immutable_fields");
    const brainstorms = [...document.brainstorms];
    brainstorms[index] = record;
    writeBrainstormStore(stateDir, { schema_version: "v1", brainstorms });
    return record;
  });
}

function writeBrainstormStore(stateDir: string, document: BrainstormStoreDocument): void {
  if (!isBrainstormStoreDocument(document)) throw new Error("invalid_brainstorm_store");
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) throw new Error("invalid_brainstorm_store");
  writeStateFileAtomically(stateDir, join(stateDir, FILE), serialized);
}

function assertCreateInput(input: unknown): asserts input is BrainstormCreateInput {
  if (!isExactRecord(input, INPUT_KEYS)) throw new Error("invalid_brainstorm");
  if (!Array.isArray(input.routes) || input.routes.length < 3 || input.routes.length > 4) {
    throw new Error("brainstorm_route_count");
  }
  if (!input.routes.every(isBrainstormRoute)) throw new Error("invalid_brainstorm");
  if (new Set(input.routes.map((route) => route.provider)).size !== input.routes.length) {
    throw new Error("brainstorm_provider_duplicate");
  }
  if (typeof input.project_id !== "string" || !PROJECT_ID_PATTERN.test(input.project_id) || !boundedString(input.brief, MAX_BRIEF_CHARS) ||
    !isBrainstormRoute(input.synthesizer_route) ||
    (input.arbitration_route !== null && !isBrainstormRoute(input.arbitration_route))) {
    throw new Error("invalid_brainstorm");
  }
  if (!isCanonicalEnvelope(input.token_envelope, input.routes as readonly BrainstormRoute[], input.synthesizer_route as BrainstormRoute, input.arbitration_route as BrainstormRoute | null)) {
    throw new Error("brainstorm_token_envelope_noncanonical");
  }
}

function isBrainstormStoreDocument(value: unknown): value is BrainstormStoreDocument {
  if (!isExactRecord(value, ["schema_version", "brainstorms"]) || value.schema_version !== "v1" ||
    !Array.isArray(value.brainstorms) || value.brainstorms.length > MAX_BRAINSTORMS) return false;
  const ids = new Set<string>();
  return value.brainstorms.every((record) => isBrainstormRecord(record) && !ids.has(record.brainstorm_id) && Boolean(ids.add(record.brainstorm_id)));
}

function isBrainstormRecord(value: unknown): value is BrainstormRecord {
  if (!isExactRecord(value, RECORD_KEYS) || value.schema_version !== "v1" ||
    !safeId(value.brainstorm_id) || typeof value.project_id !== "string" || !PROJECT_ID_PATTERN.test(value.project_id) ||
    !boundedString(value.brief, MAX_BRIEF_CHARS) || !validTimestamp(value.created_at) || !validTimestamp(value.updated_at) ||
    !Array.isArray(value.routes) || value.routes.length < 3 || value.routes.length > 4 || !value.routes.every(isBrainstormRoute) ||
    new Set(value.routes.map((route) => route.provider)).size !== value.routes.length ||
    !isBrainstormRoute(value.synthesizer_route) || (value.arbitration_route !== null && !isBrainstormRoute(value.arbitration_route)) ||
    !isCanonicalEnvelope(value.token_envelope, value.routes, value.synthesizer_route, value.arbitration_route) ||
    !Array.isArray(value.child_run_ids) || value.child_run_ids.length > value.routes.length || !uniqueSafeIds(value.child_run_ids) ||
    !nullableSafeId(value.consolidation_run_id) || !nullableSafeId(value.arbitration_run_id) ||
    (value.arbitration_route === null && value.arbitration_run_id !== null) ||
    !Array.isArray(value.conflicts) || value.conflicts.length > MAX_CONFLICTS || !validConflicts(value.conflicts) ||
    !(value.final_artifact === null || boundedString(value.final_artifact, MAX_FINAL_ARTIFACT_CHARS, true)) ||
    !STATUSES.has(value.status as BrainstormStatus) || !nullableSafeId(value.approved_by)) return false;
  return true;
}

function isBrainstormRoute(value: unknown): value is BrainstormRoute {
  return isExactRecord(value, ROUTE_KEYS) && PROVIDERS.has(value.provider as RunProvider) &&
    boundedString(value.model, MAX_MODEL_CHARS) && REASONING_EFFORTS.has(value.reasoning_effort as RunReasoningEffort) &&
    Number.isSafeInteger(value.estimated_tokens) && (value.estimated_tokens as number) > 0;
}

function isCanonicalEnvelope(value: unknown, routes: readonly BrainstormRoute[], synthesizerRoute: BrainstormRoute, arbitrationRoute: BrainstormRoute | null): value is BrainstormTokenEnvelope {
  if (!isExactRecord(value, ENVELOPE_KEYS)) return false;
  let canonical: BrainstormTokenEnvelope;
  try {
    canonical = estimateBrainstormTokenEnvelope(routes, synthesizerRoute.estimated_tokens, arbitrationRoute?.estimated_tokens ?? 0);
  } catch {
    return false;
  }
  return isDeepStrictEqual(value, canonical);
}

function sameImmutableFields(existing: BrainstormRecord, replacement: BrainstormRecord): boolean {
  return existing.schema_version === replacement.schema_version &&
    existing.brainstorm_id === replacement.brainstorm_id &&
    existing.project_id === replacement.project_id &&
    existing.brief === replacement.brief &&
    isDeepStrictEqual(existing.routes, replacement.routes) &&
    isDeepStrictEqual(existing.synthesizer_route, replacement.synthesizer_route) &&
    isDeepStrictEqual(existing.arbitration_route, replacement.arbitration_route) &&
    isDeepStrictEqual(existing.token_envelope, replacement.token_envelope) &&
    existing.created_at === replacement.created_at;
}

function validConflicts(value: readonly unknown[]): value is readonly BrainstormConflict[] {
  const ids = new Set<string>();
  return value.every((conflict) => {
    if (!isExactRecord(conflict, CONFLICT_KEYS) || !safeId(conflict.conflict_id) || ids.has(conflict.conflict_id) ||
      !Array.isArray(conflict.output_run_ids) || conflict.output_run_ids.length !== 2 ||
      !uniqueSafeIds(conflict.output_run_ids) || !boundedString(conflict.summary, MAX_CONFLICT_SUMMARY_CHARS) ||
      typeof conflict.material !== "boolean") return false;
    ids.add(conflict.conflict_id);
    return true;
  });
}

function uniqueSafeIds(value: readonly unknown[]): value is readonly string[] {
  return value.every(safeId) && new Set(value).size === value.length;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ID_CHARS && SAFE_ID_PATTERN.test(value);
}

function nullableSafeId(value: unknown): value is string | null {
  return value === null || safeId(value);
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.length > 0);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isExactRecord<const Keys extends readonly string[]>(value: unknown, keys: Keys): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function copyRoute(route: BrainstormRoute): BrainstormRoute {
  return { provider: route.provider, model: route.model, reasoning_effort: route.reasoning_effort, estimated_tokens: route.estimated_tokens };
}
