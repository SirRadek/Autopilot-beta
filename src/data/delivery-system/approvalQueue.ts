import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeStateFileAtomically } from "./stateMaintenanceLock";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalQueueRecord {
  readonly schema_version: "v1";
  readonly approval_id: string;
  readonly run_id: string | null;
  readonly revision: number | null;
  readonly session_id: string;
  readonly vendor: string;
  readonly model: string | null;
  readonly skill_ids: readonly string[];
  readonly prompt_preview: string;
  readonly prompt_file: string | null;
  readonly estimated_tokens: number;
  readonly input_token_bound: number;
  readonly output_token_allowance: number;
  readonly prompt_review_acknowledged: boolean;
  readonly status: ApprovalStatus;
  readonly created_at: string;
  readonly decided_at: string | null;
  readonly rejection_reason: string | null;
}

export interface ApprovalQueueDocument {
  readonly schema_version: "v1";
  readonly records: readonly ApprovalQueueRecord[];
}

export const APPROVAL_QUEUE_FILE = "approval-queue.json";
const MAX_QUEUE_BYTES = 1024 * 1024;
const MAX_RECORDS = 512;
const MAX_FIELD = 512;

function validText(value: unknown, maximum = MAX_FIELD): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function validate(document: unknown): asserts document is ApprovalQueueDocument {
  if (typeof document !== "object" || document === null) throw new Error("invalid_approval_queue");
  const value = document as ApprovalQueueDocument;
  if (value.schema_version !== "v1" || !Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw new Error("invalid_approval_queue");
  for (const record of value.records) {
    if (typeof record !== "object" || record === null || record.schema_version !== "v1" || !validText(record.approval_id) ||
      (record.run_id !== null && !validText(record.run_id)) || (record.revision !== null && (!Number.isSafeInteger(record.revision) || record.revision < 1)) ||
      !validText(record.session_id) || !validText(record.vendor) || (record.model !== null && !validText(record.model)) ||
      !Array.isArray(record.skill_ids) || record.skill_ids.length > 64 || !record.skill_ids.every((item: unknown) => validText(item)) ||
      typeof record.prompt_preview !== "string" || record.prompt_preview.length > 500 || (record.prompt_file !== null && !validText(record.prompt_file, 2048)) ||
      !Number.isSafeInteger(record.input_token_bound) || record.input_token_bound < 0 || !Number.isSafeInteger(record.output_token_allowance) || record.output_token_allowance < 0 ||
      !Number.isSafeInteger(record.estimated_tokens) || record.estimated_tokens !== record.input_token_bound + record.output_token_allowance || typeof record.prompt_review_acknowledged !== "boolean" || !["pending", "approved", "rejected"].includes(record.status) ||
      !validText(record.created_at, 32) || (record.decided_at !== null && !validText(record.decided_at, 32)) ||
      (record.rejection_reason !== null && !validText(record.rejection_reason, 200))) throw new Error("invalid_approval_queue");
  }
}

export function createApprovalRecord(input: {
  readonly approvalId: string;
  readonly runId?: string;
  readonly revision?: number;
  readonly sessionId: string;
  readonly vendor: string;
  readonly model?: string;
  readonly skillIds: readonly string[];
  readonly prompt: string;
  readonly promptFile?: string;
  readonly estimatedTokens: number;
  readonly inputTokenBound: number;
  readonly outputTokenAllowance: number;
  readonly promptReviewAcknowledged?: boolean;
  readonly now?: string;
}): ApprovalQueueRecord {
  return {
    schema_version: "v1",
    approval_id: input.approvalId,
    run_id: input.runId ?? null,
    revision: input.revision ?? null,
    session_id: input.sessionId,
    vendor: input.vendor,
    model: input.model ?? null,
    skill_ids: [...new Set(input.skillIds)],
    prompt_preview: input.prompt.slice(0, 500),
    prompt_file: input.promptFile ?? null,
    estimated_tokens: Math.max(0, Math.floor(input.estimatedTokens)),
    input_token_bound: input.inputTokenBound,
    output_token_allowance: input.outputTokenAllowance,
    prompt_review_acknowledged: input.promptReviewAcknowledged === true,
    status: "pending",
    created_at: input.now ?? new Date().toISOString(),
    decided_at: null,
    rejection_reason: null
  };
}

export function decideApproval(
  record: ApprovalQueueRecord,
  decision: "approved" | "rejected",
  now = new Date().toISOString(),
  rejectionReason?: string
): ApprovalQueueRecord {
  if (record.status !== "pending") throw new Error("approval_already_decided");
  return {
    ...record,
    status: decision,
    decided_at: now,
    rejection_reason: decision === "rejected" ? (rejectionReason?.slice(0, 200) ?? "rejected_by_owner") : null
  };
}

export function requireApprovedApproval(
  document: ApprovalQueueDocument,
  approvalId: string
): ApprovalQueueRecord {
  const record = document.records.find((candidate) => candidate.approval_id === approvalId);
  if (!record) throw new Error("approval_not_found");
  if (record.status !== "approved") throw new Error("approval_not_approved");
  return record;
}

export function readApprovalQueue(stateDir: string): ApprovalQueueDocument {
  const path = join(stateDir, APPROVAL_QUEUE_FILE);
  if (!existsSync(path)) return { schema_version: "v1", records: [] };
  if (statSync(path).size > MAX_QUEUE_BYTES) throw new Error("invalid_approval_queue");
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("invalid_approval_queue"); }
  if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { records?: unknown }).records)) {
    parsed = { ...(parsed as object), records: (parsed as { records: unknown[] }).records.map((record) =>
      typeof record === "object" && record !== null ? { run_id: null, revision: null, prompt_review_acknowledged: false, ...record } : record) };
  }
  validate(parsed);
  return parsed;
}

export function writeApprovalQueue(stateDir: string, document: ApprovalQueueDocument): void {
  validate(document);
  const path = join(stateDir, APPROVAL_QUEUE_FILE);
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_QUEUE_BYTES) throw new Error("invalid_approval_queue");
  writeStateFileAtomically(stateDir, path, serialized);
}
