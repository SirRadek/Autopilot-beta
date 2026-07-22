import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { resolveEnabledProject, type ProjectRegistryOptions } from "./projectRegistry";
import type { CliWorkerResult } from "./cliWorker";
import { assertRunPromptPolicy, canonicalRunTokenBudget, conservativeRunPromptTokens, RUN_OUTPUT_TOKEN_ALLOWANCE, RUN_OUTPUT_TOKEN_ALLOWANCE_MAX } from "./runPromptPolicy";
import { writeStateFileAtomically } from "./stateMaintenanceLock";
import { SUPPORTED_REASONING_EFFORTS, type RunProfile, type RunReasoningEffort, type StoredRunProfile } from "./executionProfile";

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
  readonly input_token_bound: number;
  readonly output_token_allowance: number;
  readonly requested_artifacts: readonly RunArtifactType[];
  readonly prompt_review_acknowledged: boolean;
  readonly profile: RunProfile;
  readonly requested_reasoning_effort: RunReasoningEffort | null;
  readonly promotion_packet_id: string | null;
  readonly created_at: string;
}

export type RunDraftInput = Omit<RunDraft, "run_id" | "revision" | "created_at" | "prompt_review_acknowledged" | "input_token_bound" | "output_token_allowance" | "promotion_packet_id"> &
  { readonly prompt_review_acknowledged?: boolean; readonly promotion_packet_id?: string | null };

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
  readonly groupId?: string;
  readonly slotId?: string;
  readonly heldTokens?: number;
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
  readonly orchestration_ref: { readonly group_id: string; readonly slot_id: string } | null;
  readonly orchestration_request: { readonly operator: string; readonly estimated_tokens: number } | null;
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
  readonly retry_input_tokens: number;
  readonly retry_output_tokens: number;
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
const PROFILES = new Set<RunProfile>(["dev", "prod"]);
const REASONING_EFFORTS = new Set<RunReasoningEffort>(["low", "medium", "high", "xhigh", "max"]);
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

function validDraftInput(input: RunDraftInput & Pick<RunDraft, "input_token_bound" | "output_token_allowance">): boolean {
  try { assertRunPromptPolicy(input.prompt, input.prompt_review_acknowledged === true); } catch { return false; }
  return typeof input.project_id === "string" && PROJECT_ID_PATTERN.test(input.project_id) &&
    typeof input.prompt === "string" && input.prompt.length <= MAX_PROMPT &&
    PROVIDERS.has(input.provider) && (input.model === null || validString(input.model, MAX_MODEL, true)) &&
    typeof input.prompt_review_acknowledged === "boolean" && input.input_token_bound === conservativeRunPromptTokens(input.prompt) &&
    input.output_token_allowance === RUN_OUTPUT_TOKEN_ALLOWANCE && input.output_token_allowance <= RUN_OUTPUT_TOKEN_ALLOWANCE_MAX &&
    input.estimated_tokens === input.input_token_bound + input.output_token_allowance &&
    Array.isArray(input.requested_artifacts) && input.requested_artifacts.length <= ARTIFACT_TYPES.size &&
    new Set(input.requested_artifacts).size === input.requested_artifacts.length &&
    input.requested_artifacts.every((type) => ARTIFACT_TYPES.has(type));
}

function validStoredProfileFields(draft: { readonly provider?: unknown; readonly profile?: unknown; readonly requested_reasoning_effort?: unknown; readonly promotion_packet_id?: unknown }): boolean {
  if (draft.profile === undefined) return draft.requested_reasoning_effort === undefined && draft.promotion_packet_id === undefined;
  if (!PROFILES.has(draft.profile as RunProfile)) return false;
  if (draft.requested_reasoning_effort !== null) {
    if (!REASONING_EFFORTS.has(draft.requested_reasoning_effort as RunReasoningEffort)) return false;
    if (!PROVIDERS.has(draft.provider as RunProvider)) return false;
    const supported: readonly RunReasoningEffort[] = SUPPORTED_REASONING_EFFORTS[draft.provider as RunProvider];
    if (!supported.includes(draft.requested_reasoning_effort as RunReasoningEffort)) return false;
  }
  if (draft.profile === "dev") return draft.promotion_packet_id === null;
  return validString(draft.promotion_packet_id, MAX_ID);
}

function validDraft(value: unknown): value is RunDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as RunDraft;
  return validString(draft.run_id, MAX_ID) && Number.isSafeInteger(draft.revision) && draft.revision > 0 &&
    validTimestamp(draft.created_at) && validDraftInput(draft) && validStoredProfileFields(draft);
}

function normalizeProfileFields(input: RunDraftInput): Pick<RunDraft, "requested_reasoning_effort" | "promotion_packet_id"> {
  if (!PROFILES.has(input.profile)) throw new Error("invalid_run_draft");
  const effort = input.requested_reasoning_effort;
  if (effort !== null) {
    const supported: readonly RunReasoningEffort[] = SUPPORTED_REASONING_EFFORTS[input.provider];
    if (!REASONING_EFFORTS.has(effort) || !supported.includes(effort)) throw new Error("invalid_run_draft");
  }
  if (input.profile === "dev") {
    if (input.promotion_packet_id !== undefined && input.promotion_packet_id !== null) throw new Error("invalid_run_draft");
    return { requested_reasoning_effort: effort, promotion_packet_id: null };
  }
  if (!validString(input.promotion_packet_id, MAX_ID)) throw new Error("invalid_run_draft");
  return { requested_reasoning_effort: effort, promotion_packet_id: input.promotion_packet_id };
}

export function resolveRunProfile(record: RunRecord): StoredRunProfile {
  const value = (record.current as { readonly profile?: RunProfile }).profile;
  return value === "dev" || value === "prod" ? value : "legacy";
}

export function resolveLegacyRequestedReasoning(record: RunRecord): RunReasoningEffort | null {
  return resolveRunProfile(record) === "legacy" ? null : record.current.requested_reasoning_effort;
}

export function resolveLegacyPromotionPacketId(record: RunRecord): string | null {
  return resolveRunProfile(record) === "legacy" ? null : record.current.promotion_packet_id;
}

function validNullableString(value: unknown, maximum: number): boolean {
  return value === null || validString(value, maximum);
}

function validReservation(value: RunReservation | null): boolean {
  return value === null || (validString(value.reservationId, MAX_ID) && validString(value.provider, MAX_ID) &&
    validNullableString(value.model, MAX_MODEL) && validNullableString(value.sessionId, MAX_ID) &&
    Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 0 && Number.isSafeInteger(value.outputTokens) && value.outputTokens >= 0 &&
    Number.isSafeInteger(value.totalTokens) && value.totalTokens === value.inputTokens + value.outputTokens && validTimestamp(value.reservedAt) &&
    (value.handoffId === undefined || validString(value.handoffId, MAX_ID)) &&
    ((value.groupId === undefined && value.slotId === undefined && value.heldTokens === undefined) ||
      (validString(value.groupId, MAX_ID) && validString(value.slotId, MAX_ID) && Number.isSafeInteger(value.heldTokens) && value.heldTokens! >= value.totalTokens)));
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
  const orchestrationRefs = new Set<string>();
  for (const record of candidate.runs) {
    if (typeof record !== "object" || record === null) throw new Error("invalid_run_store");
    const value = record as RunRecord;
    const approvalIsValid = value.status === "draft" ? lacksApproval(value) :
      value.status === "cancelled" ? lacksApproval(value) || hasApproval(value) : hasApproval(value);
    const artifactIds = new Set<string>();
    const orchestrationKey = value.orchestration_ref === null ? null : JSON.stringify([value.orchestration_ref.group_id, value.orchestration_ref.slot_id]);
    if (value.schema_version !== "v1" || !(value.orchestration_ref === null || (validString(value.orchestration_ref?.group_id, MAX_ID) && validString(value.orchestration_ref?.slot_id, MAX_ID))) ||
      (value.orchestration_ref === null) !== (value.orchestration_request === null) || !(value.orchestration_request === null || (validString(value.orchestration_request?.operator, MAX_OPERATOR) && Number.isSafeInteger(value.orchestration_request?.estimated_tokens) && value.orchestration_request.estimated_tokens >= 0)) ||
      (orchestrationKey !== null && orchestrationRefs.has(orchestrationKey)) || !Array.isArray(value.revisions) || value.revisions.length === 0 || value.revisions.length > MAX_REVISIONS ||
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
      !Number.isSafeInteger(value.retry_input_tokens) || value.retry_input_tokens < 0 || !Number.isSafeInteger(value.retry_output_tokens) || value.retry_output_tokens < 0 ||
      !value.artifacts.every((artifact) => validString(artifact.artifact_id, MAX_ID) && !artifactIds.has(artifact.artifact_id) &&
        artifactIds.add(artifact.artifact_id) && ARTIFACT_TYPES.has(artifact.type) && typeof artifact.preview === "string" &&
        artifact.preview.length <= MAX_PREVIEW && validTimestamp(artifact.created_at))) {
      throw new Error("invalid_run_store");
    }
    runIds.add(value.current.run_id);
    if (orchestrationKey !== null) orchestrationRefs.add(orchestrationKey);
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
    document = { ...(document as object), runs: (document as { runs: unknown[] }).runs.map((run) => {
      if (typeof run !== "object" || run === null) return run;
      const record = run as RunRecord;
      const revisions = Array.isArray(record.revisions) ? record.revisions.map((revision) => ({ prompt_review_acknowledged: false, ...(revision as unknown as Record<string, unknown>) })) : record.revisions;
      const current = record.current === undefined ? record.current : { prompt_review_acknowledged: false, ...(record.current as unknown as Record<string, unknown>) };
      return { orchestration_ref: null, orchestration_request: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, ...(record as unknown as Record<string, unknown>), current, revisions, ...(record.provider_result === null || record.provider_result === undefined ? {} : { provider_result: { exit_code: null, error_reason: null, lock_status: null, ...(record.provider_result as unknown as Record<string, unknown>) } }) };
    }) };
  }
  validate(document);
  return document;
}

function write(stateDir: string, document: RunStoreDocument): void {
  validate(document);
  const path = join(stateDir, FILE);
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) throw new Error("invalid_run_store");
  writeStateFileAtomically(stateDir, path, serialized);
}

function replace(stateDir: string, record: RunRecord): RunRecord {
  const document = readRunStore(stateDir);
  const original = document.runs.find((run) => run.current.run_id === record.current.run_id);
  if (original === undefined || resolveRunProfile(original) === "legacy") throw new Error("legacy_run_read_only");
  write(stateDir, { ...document, runs: document.runs.map((run) => run.current.run_id === record.current.run_id ? record : run) });
  return record;
}

function find(stateDir: string, runId: string): RunRecord {
  const record = readRunStore(stateDir).runs.find((run) => run.current.run_id === runId);
  if (record === undefined) throw new Error("run_not_found");
  return record;
}

export function createRunDraft(stateDir: string, input: RunDraftInput, createdAt: string, registryOptions: ProjectRegistryOptions = {}): RunDraft {
  resolveEnabledProject(stateDir, input.project_id, registryOptions);
  assertRunPromptPolicy(input.prompt, input.prompt_review_acknowledged === true);
  const canonicalBudget = canonicalRunTokenBudget(input.prompt);
  if (!Number.isSafeInteger(input.estimated_tokens) || input.estimated_tokens < canonicalBudget) throw new Error("run_token_budget_underestimated");
  const profileFields = normalizeProfileFields(input);
  const normalized = { ...input, ...profileFields, input_token_bound: conservativeRunPromptTokens(input.prompt), output_token_allowance: RUN_OUTPUT_TOKEN_ALLOWANCE, estimated_tokens: canonicalBudget, prompt_review_acknowledged: input.prompt_review_acknowledged === true };
  if (!validDraftInput(normalized) || !validTimestamp(createdAt)) throw new Error("invalid_run_draft");
  const document = readRunStore(stateDir);
  if (document.runs.length >= MAX_RUNS) throw new Error("run_limit");
  const draft: RunDraft = { ...normalized, requested_artifacts: [...input.requested_artifacts], run_id: randomUUID(), revision: 1, created_at: createdAt };
  const record: RunRecord = { schema_version: "v1", orchestration_ref: null, orchestration_request: null, current: draft, revisions: [draft], status: "draft", approved_revision: null, approved_by: null, approved_at: null, supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: createdAt };
  write(stateDir, { ...document, runs: [...document.runs, record] });
  return draft;
}

export function createGroupRunDraft(stateDir: string, runId: string, orchestrationRef: { readonly group_id: string; readonly slot_id: string }, operator: string, input: RunDraftInput, createdAt: string, registryOptions: ProjectRegistryOptions = {}): RunDraft {
  if (!validString(runId, MAX_ID) || !validString(orchestrationRef.group_id, MAX_ID) || !validString(orchestrationRef.slot_id, MAX_ID) || !validString(operator, MAX_OPERATOR)) throw new Error("invalid_run_draft");
  resolveEnabledProject(stateDir, input.project_id, registryOptions);
  assertRunPromptPolicy(input.prompt, input.prompt_review_acknowledged === true);
  const canonicalBudget = canonicalRunTokenBudget(input.prompt);
  if (!Number.isSafeInteger(input.estimated_tokens) || input.estimated_tokens < canonicalBudget) throw new Error("run_token_budget_underestimated");
  const profileFields = normalizeProfileFields(input);
  const normalized = { ...input, ...profileFields, input_token_bound: conservativeRunPromptTokens(input.prompt), output_token_allowance: RUN_OUTPUT_TOKEN_ALLOWANCE, estimated_tokens: canonicalBudget, prompt_review_acknowledged: input.prompt_review_acknowledged === true };
  if (!validDraftInput(normalized) || !validTimestamp(createdAt)) throw new Error("invalid_run_draft");
  const document = readRunStore(stateDir);
  if (document.runs.some((run) => run.current.run_id === runId || (run.orchestration_ref?.group_id === orchestrationRef.group_id && run.orchestration_ref.slot_id === orchestrationRef.slot_id))) throw new Error("orchestration_group_run_exists");
  if (document.runs.length >= MAX_RUNS) throw new Error("run_limit");
  const draft: RunDraft = { ...normalized, requested_artifacts: [...input.requested_artifacts], run_id: runId, revision: 1, created_at: createdAt };
  const record: RunRecord = { schema_version: "v1", orchestration_ref: orchestrationRef, orchestration_request: { operator, estimated_tokens: input.estimated_tokens }, current: draft, revisions: [draft], status: "draft", approved_revision: null, approved_by: null, approved_at: null, supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: createdAt };
  write(stateDir, { ...document, runs: [...document.runs, record] });
  return draft;
}

export function reviseRunDraft(stateDir: string, runId: string, revision: number, input: RunDraftInput, createdAt: string, registryOptions: ProjectRegistryOptions = {}): RunDraft {
  const record = find(stateDir, runId);
  if (record.status !== "draft" || record.current.revision !== revision) throw new Error("run_revision_conflict");
  if (record.revisions.length >= MAX_REVISIONS) throw new Error("run_revision_limit");
  resolveEnabledProject(stateDir, input.project_id, registryOptions);
  assertRunPromptPolicy(input.prompt, input.prompt_review_acknowledged === true);
  const canonicalBudget = canonicalRunTokenBudget(input.prompt);
  if (!Number.isSafeInteger(input.estimated_tokens) || input.estimated_tokens < canonicalBudget) throw new Error("run_token_budget_underestimated");
  const profileFields = normalizeProfileFields(input);
  const normalized = { ...input, ...profileFields, input_token_bound: conservativeRunPromptTokens(input.prompt), output_token_allowance: RUN_OUTPUT_TOKEN_ALLOWANCE, estimated_tokens: canonicalBudget, prompt_review_acknowledged: input.prompt_review_acknowledged === true };
  if (!validDraftInput(normalized) || !validTimestamp(createdAt)) throw new Error("invalid_run_draft");
  const draft: RunDraft = { ...normalized, requested_artifacts: [...input.requested_artifacts], run_id: runId, revision: revision + 1, created_at: createdAt };
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
  if (record.status !== "approved" || record.supervisor_task_id !== null || !validString(taskId, MAX_ID) || !validReservation(reservation) || reservation.totalTokens !== record.current.estimated_tokens || !validTimestamp(updatedAt)) throw new Error("invalid_run_binding");
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

export function clearRunProviderResultForRetry(stateDir: string, runId: string, inputTokens: number, outputTokens: number, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.provider_result === null || !Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0 || !validTimestamp(updatedAt)) throw new Error("invalid_run_provider_result");
  return replace(stateDir, { ...record, provider_result: null, worker_run_id: null, retry_input_tokens: record.retry_input_tokens + inputTokens, retry_output_tokens: record.retry_output_tokens + outputTokens, updated_at: updatedAt });
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
