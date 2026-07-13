import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { resolveEnabledProject } from "./projectRegistry";
import type { CliWorkerResult } from "./cliWorker";

export type RunStatus = "draft" | "approved" | "queued" | "running" | "completed" | "failed" | "cancelled";
export type RunProvider = "codex_cli" | "claude_cli" | "agy_cli" | "openrouter_api";
export type RunArtifactType = "text" | "visual";

export interface RunDraft {
  readonly run_id: string;
  readonly revision: number;
  readonly project_id: string;
  readonly prompt: string;
  readonly provider: RunProvider;
  readonly model: string | null;
  readonly estimated_tokens: number;
  readonly requested_artifacts: readonly RunArtifactType[];
  readonly created_at: string;
}

export type RunDraftInput = Omit<RunDraft, "run_id" | "revision" | "created_at">;

export interface RunArtifact {
  readonly artifact_id: string;
  readonly type: RunArtifactType;
  readonly preview: string;
  readonly created_at: string;
}

export interface RunReservation {
  readonly reservationId: string;
  readonly provider: string;
  readonly model: string | null;
  readonly sessionId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly handoffId?: string;
  readonly reservedAt: string;
  readonly totalTokens: number;
}

export interface RunProviderResult {
  readonly refused: boolean;
  readonly reason: string | null;
  readonly worker_run_id: string | null;
  readonly raw_output: string;
  readonly exit_code: number | null;
  readonly error_reason: string | null;
  readonly lock_status: CliWorkerResult["lockStatus"] | null;
}

export type RunArtifactInput = Omit<RunArtifact, "created_at">;

export interface RunRecord {
  readonly schema_version: "v1";
  readonly current: RunDraft;
  readonly revisions: readonly RunDraft[];
  readonly status: RunStatus;
  readonly approved_revision: number | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly supervisor_task_id: string | null;
  readonly worker_run_id: string | null;
  readonly terminal_reason: string | null;
  readonly token_reservation: RunReservation | null;
  readonly reservation_status: "none" | "active" | "settled" | "released";
  readonly provider_result: RunProviderResult | null;
  readonly cancellation_requested: boolean;
  readonly queue_compensation_requested: boolean;
  readonly dispatch_failure: string | null;
  readonly artifacts: readonly RunArtifact[];
  readonly updated_at: string;
}

export interface RunStoreDocument {
  readonly schema_version: "v1";
  readonly runs: readonly RunRecord[];
}

const FILE = "runs.json";
const MAX_RUNS = 256;
const MAX_REVISIONS = 20;
const MAX_PROMPT = 32_000;
const MAX_ARTIFACTS = 32;
const MAX_PREVIEW = 32_000;
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const MAX_ID = 256;
const MAX_MODEL = 256;
const MAX_OPERATOR = 256;
const MAX_TERMINAL_REASON = 32_000;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const PROVIDERS = new Set<RunProvider>(["codex_cli", "claude_cli", "agy_cli", "openrouter_api"]);
const ARTIFACT_TYPES = new Set<RunArtifactType>(["text", "visual"]);
const STATUSES = new Set<RunStatus>(["draft", "approved", "queued", "running", "completed", "failed", "cancelled"]);
const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  draft: ["cancelled"], approved: ["queued", "cancelled"], queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"], completed: [], failed: [], cancelled: []
};

function validString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= maximum;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validDraftInput(input: RunDraftInput): boolean {
  return typeof input.project_id === "string" && PROJECT_ID_PATTERN.test(input.project_id) &&
    typeof input.prompt === "string" && input.prompt.length <= MAX_PROMPT &&
    PROVIDERS.has(input.provider) && (input.model === null || validString(input.model, MAX_MODEL, true)) &&
    Number.isSafeInteger(input.estimated_tokens) && input.estimated_tokens >= 0 &&
    Array.isArray(input.requested_artifacts) && input.requested_artifacts.length <= ARTIFACT_TYPES.size &&
    new Set(input.requested_artifacts).size === input.requested_artifacts.length &&
    input.requested_artifacts.every((type) => ARTIFACT_TYPES.has(type));
}

function validDraft(value: unknown): value is RunDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as RunDraft;
  return validString(draft.run_id, MAX_ID) && Number.isSafeInteger(draft.revision) && draft.revision > 0 &&
    validTimestamp(draft.created_at) && validDraftInput(draft);
}

function validNullableString(value: unknown, maximum: number): boolean {
  return value === null || validString(value, maximum);
}

function validReservation(value: RunReservation | null): boolean {
  return value === null || (validString(value.reservationId, MAX_ID) && validString(value.provider, MAX_ID) &&
    validNullableString(value.model, MAX_MODEL) && validNullableString(value.sessionId, MAX_ID) &&
    Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 0 && Number.isSafeInteger(value.outputTokens) && value.outputTokens >= 0 &&
    Number.isSafeInteger(value.totalTokens) && value.totalTokens === value.inputTokens + value.outputTokens && validTimestamp(value.reservedAt) &&
    (value.handoffId === undefined || validString(value.handoffId, MAX_ID)));
}

function validProviderResult(value: RunProviderResult | null): boolean {
  return value === null || (typeof value.refused === "boolean" && validNullableString(value.reason, MAX_TERMINAL_REASON) &&
    validNullableString(value.worker_run_id, MAX_ID) && typeof value.raw_output === "string" && value.raw_output.length <= MAX_PREVIEW &&
    (value.exit_code === null || Number.isSafeInteger(value.exit_code)) && validNullableString(value.error_reason, MAX_TERMINAL_REASON) &&
    (value.lock_status === null || ["acquired_supervisor_spawn", "already_locked", "stale_replaced", "failed"].includes(value.lock_status)));
}

function hasApproval(record: RunRecord): boolean {
  return record.approved_revision === record.current.revision &&
    validString(record.approved_by, MAX_OPERATOR) && validTimestamp(record.approved_at);
}

function lacksApproval(record: RunRecord): boolean {
  return record.approved_revision === null && record.approved_by === null && record.approved_at === null;
}

function validate(document: unknown): asserts document is RunStoreDocument {
  if (typeof document !== "object" || document === null) throw new Error("invalid_run_store");
  const candidate = document as Partial<RunStoreDocument>;
  if (candidate.schema_version !== "v1" || !Array.isArray(candidate.runs) || candidate.runs.length > MAX_RUNS) throw new Error("invalid_run_store");
  const runIds = new Set<string>();
  for (const record of candidate.runs) {
    if (typeof record !== "object" || record === null) throw new Error("invalid_run_store");
    const value = record as RunRecord;
    const approvalIsValid = value.status === "draft" ? lacksApproval(value) :
      value.status === "cancelled" ? lacksApproval(value) || hasApproval(value) : hasApproval(value);
    const artifactIds = new Set<string>();
    if (value.schema_version !== "v1" || !Array.isArray(value.revisions) || value.revisions.length === 0 || value.revisions.length > MAX_REVISIONS ||
      !Array.isArray(value.artifacts) || value.artifacts.length > MAX_ARTIFACTS || !validDraft(value.current) ||
      runIds.has(value.current.run_id) || value.current.revision !== value.revisions.length || !STATUSES.has(value.status) || !approvalIsValid ||
      !isDeepStrictEqual(value.current, value.revisions.at(-1)) ||
      !value.revisions.every((revision, index) => validDraft(revision) && revision.run_id === value.current.run_id && revision.revision === index + 1) ||
      !validNullableString(value.supervisor_task_id, MAX_ID) || !validNullableString(value.worker_run_id, MAX_ID) ||
      !validNullableString(value.terminal_reason, MAX_TERMINAL_REASON) || !validTimestamp(value.updated_at) ||
      !validReservation(value.token_reservation) || !["none", "active", "settled", "released"].includes(value.reservation_status) ||
      (value.reservation_status === "none") !== (value.token_reservation === null) || !validProviderResult(value.provider_result) ||
      typeof value.cancellation_requested !== "boolean" ||
      typeof value.queue_compensation_requested !== "boolean" ||
      !validNullableString(value.dispatch_failure, MAX_TERMINAL_REASON) ||
      !value.artifacts.every((artifact) => validString(artifact.artifact_id, MAX_ID) && !artifactIds.has(artifact.artifact_id) &&
        artifactIds.add(artifact.artifact_id) && ARTIFACT_TYPES.has(artifact.type) && typeof artifact.preview === "string" &&
        artifact.preview.length <= MAX_PREVIEW && validTimestamp(artifact.created_at))) {
      throw new Error("invalid_run_store");
    }
    runIds.add(value.current.run_id);
  }
}

export function readRunStore(stateDir: string): RunStoreDocument {
  const path = join(stateDir, FILE);
  if (!existsSync(path)) return { schema_version: "v1", runs: [] };
  if (statSync(path).size > MAX_STORE_BYTES) throw new Error("invalid_run_store");
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("invalid_run_store");
  }
  if (typeof document === "object" && document !== null && Array.isArray((document as { runs?: unknown }).runs)) {
    document = { ...(document as object), runs: (document as { runs: unknown[] }).runs.map((run) =>
      typeof run === "object" && run !== null ? { token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, ...run, ...((run as RunRecord).provider_result === null || (run as RunRecord).provider_result === undefined ? {} : { provider_result: { exit_code: null, error_reason: null, lock_status: null, ...(run as RunRecord).provider_result } }) } : run) };
  }
  validate(document);
  return document;
}

function write(stateDir: string, document: RunStoreDocument): void {
  validate(document);
  const path = join(stateDir, FILE);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) throw new Error("invalid_run_store");
  try {
    writeFileSync(temporary, serialized, "utf8");
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function replace(stateDir: string, record: RunRecord): RunRecord {
  const document = readRunStore(stateDir);
  write(stateDir, { ...document, runs: document.runs.map((run) => run.current.run_id === record.current.run_id ? record : run) });
  return record;
}

function find(stateDir: string, runId: string): RunRecord {
  const record = readRunStore(stateDir).runs.find((run) => run.current.run_id === runId);
  if (record === undefined) throw new Error("run_not_found");
  return record;
}

export function createRunDraft(stateDir: string, input: RunDraftInput, createdAt: string): RunDraft {
  resolveEnabledProject(stateDir, input.project_id);
  if (!validDraftInput(input) || !validTimestamp(createdAt)) throw new Error("invalid_run_draft");
  const document = readRunStore(stateDir);
  if (document.runs.length >= MAX_RUNS) throw new Error("run_limit");
  const draft: RunDraft = { ...input, requested_artifacts: [...input.requested_artifacts], run_id: randomUUID(), revision: 1, created_at: createdAt };
  const record: RunRecord = { schema_version: "v1", current: draft, revisions: [draft], status: "draft", approved_revision: null, approved_by: null, approved_at: null, supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, artifacts: [], updated_at: createdAt };
  write(stateDir, { ...document, runs: [...document.runs, record] });
  return draft;
}

export function reviseRunDraft(stateDir: string, runId: string, revision: number, input: RunDraftInput, createdAt: string): RunDraft {
  const record = find(stateDir, runId);
  if (record.status !== "draft" || record.current.revision !== revision) throw new Error("run_revision_conflict");
  if (record.revisions.length >= MAX_REVISIONS) throw new Error("run_revision_limit");
  resolveEnabledProject(stateDir, input.project_id);
  if (!validDraftInput(input) || !validTimestamp(createdAt)) throw new Error("invalid_run_draft");
  const draft: RunDraft = { ...input, requested_artifacts: [...input.requested_artifacts], run_id: runId, revision: revision + 1, created_at: createdAt };
  replace(stateDir, { ...record, current: draft, revisions: [...record.revisions, draft], updated_at: createdAt });
  return draft;
}

export function approveRunRevision(stateDir: string, runId: string, revision: number, operator: string, approvedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.approved_revision === revision && record.approved_by === operator) return record;
  if (record.status !== "draft" || record.current.revision !== revision) throw new Error("run_revision_conflict");
  if (!validString(operator, MAX_OPERATOR) || !validTimestamp(approvedAt)) throw new Error("invalid_run_approval");
  return replace(stateDir, { ...record, status: "approved", approved_revision: revision, approved_by: operator, approved_at: approvedAt, updated_at: approvedAt });
}

export function transitionRun(stateDir: string, runId: string, status: RunStatus, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (!STATUSES.has(status) || !validTimestamp(updatedAt) || !transitions[record.status].includes(status)) throw new Error("invalid_run_transition");
  return replace(stateDir, { ...record, status, updated_at: updatedAt });
}

export function appendRunArtifact(stateDir: string, runId: string, input: RunArtifactInput, createdAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.artifacts.length >= MAX_ARTIFACTS) throw new Error("run_artifact_limit");
  if (!validString(input.artifact_id, MAX_ID) || record.artifacts.some((artifact) => artifact.artifact_id === input.artifact_id) ||
    !ARTIFACT_TYPES.has(input.type) || typeof input.preview !== "string" || input.preview.length > MAX_PREVIEW || !validTimestamp(createdAt)) {
    throw new Error("invalid_run_artifact");
  }
  return replace(stateDir, { ...record, artifacts: [...record.artifacts, { ...input, created_at: createdAt }], updated_at: createdAt });
}

export function bindRunToSupervisor(stateDir: string, runId: string, taskId: string, reservation: RunReservation, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.status !== "approved" || record.supervisor_task_id !== null || !validString(taskId, MAX_ID) || !validReservation(reservation) || !validTimestamp(updatedAt)) throw new Error("invalid_run_binding");
  return replace(stateDir, { ...record, supervisor_task_id: taskId, token_reservation: reservation, reservation_status: "active", updated_at: updatedAt });
}

export function clearRunSupervisorBinding(stateDir: string, runId: string, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.status !== "approved" || !validTimestamp(updatedAt)) throw new Error("invalid_run_binding");
  return replace(stateDir, { ...record, supervisor_task_id: null, token_reservation: null, reservation_status: "none", queue_compensation_requested: false, updated_at: updatedAt });
}

export function recordRunProviderResult(stateDir: string, runId: string, result: RunProviderResult, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (!["queued", "running"].includes(record.status) || !validProviderResult(result) || !validTimestamp(updatedAt)) throw new Error("invalid_run_provider_result");
  if (record.provider_result !== null) return record;
  return replace(stateDir, { ...record, provider_result: result, worker_run_id: result.worker_run_id, updated_at: updatedAt });
}

export function markRunReservationTerminal(stateDir: string, runId: string, status: "settled" | "released", updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.reservation_status === status) return record;
  if (record.reservation_status !== "active" || !validTimestamp(updatedAt)) throw new Error("invalid_run_reservation_transition");
  return replace(stateDir, { ...record, reservation_status: status, updated_at: updatedAt });
}

export function finalizeRun(stateDir: string, runId: string, status: "completed" | "failed", reason: string | null, updatedAt: string): RunRecord {
  let record = find(stateDir, runId);
  if (record.status === status) return record;
  if (record.status === "queued") record = transitionRun(stateDir, runId, "running", updatedAt);
  if (record.status !== "running" || !validNullableString(reason, MAX_TERMINAL_REASON)) throw new Error("invalid_run_transition");
  return replace(stateDir, { ...record, status, terminal_reason: reason, updated_at: updatedAt });
}

export function requestRunCancellation(stateDir: string, runId: string, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.cancellation_requested) return record;
  if (["completed", "failed", "cancelled"].includes(record.status) || !validTimestamp(updatedAt)) throw new Error("invalid_run_cancellation");
  return replace(stateDir, { ...record, cancellation_requested: true, updated_at: updatedAt });
}

export function requestRunQueueCompensation(stateDir: string, runId: string, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.queue_compensation_requested) return record;
  if (record.status !== "approved" || record.supervisor_task_id === null || record.token_reservation === null || !validTimestamp(updatedAt)) throw new Error("invalid_run_compensation");
  return replace(stateDir, { ...record, queue_compensation_requested: true, updated_at: updatedAt });
}

export function recordRunDispatchFailure(stateDir: string, runId: string, reason: string, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.dispatch_failure !== null) return record;
  if (!["queued", "running"].includes(record.status) || !validString(reason, MAX_TERMINAL_REASON) || !validTimestamp(updatedAt)) throw new Error("invalid_run_dispatch_failure");
  return replace(stateDir, { ...record, dispatch_failure: reason, updated_at: updatedAt });
}

export function clearRunDispatchFailure(stateDir: string, runId: string, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.dispatch_failure === null) return record;
  if (!validTimestamp(updatedAt)) throw new Error("invalid_run_dispatch_failure");
  return replace(stateDir, { ...record, dispatch_failure: null, updated_at: updatedAt });
}
