import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ApprovalQueueDocument;
  if (parsed.schema_version !== "v1" || !Array.isArray(parsed.records)) throw new Error("invalid_approval_queue");
  return parsed;
}

export function writeApprovalQueue(stateDir: string, document: ApprovalQueueDocument): void {
  writeFileSync(join(stateDir, APPROVAL_QUEUE_FILE), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}
