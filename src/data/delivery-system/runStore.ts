import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveEnabledProject } from "./projectRegistry";

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
const PROVIDERS = new Set<RunProvider>(["codex_cli", "claude_cli", "agy_cli", "openrouter_api"]);
const ARTIFACT_TYPES = new Set<RunArtifactType>(["text", "visual"]);
const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  draft: ["cancelled"], approved: ["queued", "cancelled"], queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"], completed: [], failed: [], cancelled: []
};

function validDraft(input: RunDraftInput): boolean {
  return typeof input.project_id === "string" && typeof input.prompt === "string" && input.prompt.length <= MAX_PROMPT &&
    PROVIDERS.has(input.provider) && (input.model === null || typeof input.model === "string") &&
    Number.isSafeInteger(input.estimated_tokens) && input.estimated_tokens >= 0 &&
    Array.isArray(input.requested_artifacts) && input.requested_artifacts.every((type) => ARTIFACT_TYPES.has(type));
}

function validate(document: unknown): asserts document is RunStoreDocument {
  if (typeof document !== "object" || document === null) throw new Error("invalid_run_store");
  const candidate = document as Partial<RunStoreDocument>;
  if (candidate.schema_version !== "v1" || !Array.isArray(candidate.runs) || candidate.runs.length > MAX_RUNS) throw new Error("invalid_run_store");
  for (const record of candidate.runs) {
    if (typeof record !== "object" || record === null) throw new Error("invalid_run_store");
    const value = record as RunRecord;
    if (value.schema_version !== "v1" || !Array.isArray(value.revisions) || value.revisions.length === 0 || value.revisions.length > MAX_REVISIONS ||
      !Array.isArray(value.artifacts) || value.artifacts.length > MAX_ARTIFACTS || !validDraft(value.current) || value.current.revision !== value.revisions.length ||
      !value.revisions.every((revision, index) => validDraft(revision) && revision.run_id === value.current.run_id && revision.revision === index + 1) ||
      !value.artifacts.every((artifact) => typeof artifact.artifact_id === "string" && ARTIFACT_TYPES.has(artifact.type) && typeof artifact.preview === "string" && artifact.preview.length <= MAX_PREVIEW)) {
      throw new Error("invalid_run_store");
    }
  }
}

export function readRunStore(stateDir: string): RunStoreDocument {
  const path = join(stateDir, FILE);
  if (!existsSync(path)) return { schema_version: "v1", runs: [] };
  if (statSync(path).size > 16 * 1024 * 1024) throw new Error("invalid_run_store");
  const document: unknown = JSON.parse(readFileSync(path, "utf8"));
  validate(document);
  return document;
}

function write(stateDir: string, document: RunStoreDocument): void {
  validate(document);
  const path = join(stateDir, FILE);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
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
  if (!validDraft(input)) throw new Error("invalid_run_draft");
  const document = readRunStore(stateDir);
  if (document.runs.length >= MAX_RUNS) throw new Error("run_limit");
  const draft: RunDraft = { ...input, requested_artifacts: [...input.requested_artifacts], run_id: randomUUID(), revision: 1, created_at: createdAt };
  const record: RunRecord = { schema_version: "v1", current: draft, revisions: [draft], status: "draft", approved_revision: null, approved_by: null, approved_at: null, supervisor_task_id: null, worker_run_id: null, terminal_reason: null, artifacts: [], updated_at: createdAt };
  write(stateDir, { ...document, runs: [...document.runs, record] });
  return draft;
}

export function reviseRunDraft(stateDir: string, runId: string, revision: number, input: RunDraftInput, createdAt: string): RunDraft {
  const record = find(stateDir, runId);
  if (record.status !== "draft" || record.current.revision !== revision) throw new Error("run_revision_conflict");
  if (record.revisions.length >= MAX_REVISIONS) throw new Error("run_revision_limit");
  resolveEnabledProject(stateDir, input.project_id);
  if (!validDraft(input)) throw new Error("invalid_run_draft");
  const draft: RunDraft = { ...input, requested_artifacts: [...input.requested_artifacts], run_id: runId, revision: revision + 1, created_at: createdAt };
  replace(stateDir, { ...record, current: draft, revisions: [...record.revisions, draft], updated_at: createdAt });
  return draft;
}

export function approveRunRevision(stateDir: string, runId: string, revision: number, operator: string, approvedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.status === "approved" && record.approved_revision === revision && record.approved_by === operator) return record;
  if (record.status !== "draft" || record.current.revision !== revision) throw new Error("run_revision_conflict");
  return replace(stateDir, { ...record, status: "approved", approved_revision: revision, approved_by: operator, approved_at: approvedAt, updated_at: approvedAt });
}

export function transitionRun(stateDir: string, runId: string, status: RunStatus, updatedAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (!transitions[record.status].includes(status)) throw new Error("invalid_run_transition");
  return replace(stateDir, { ...record, status, updated_at: updatedAt });
}

export function appendRunArtifact(stateDir: string, runId: string, input: RunArtifactInput, createdAt: string): RunRecord {
  const record = find(stateDir, runId);
  if (record.artifacts.length >= MAX_ARTIFACTS) throw new Error("run_artifact_limit");
  if (typeof input.artifact_id !== "string" || !ARTIFACT_TYPES.has(input.type) || typeof input.preview !== "string" || input.preview.length > MAX_PREVIEW) throw new Error("invalid_run_artifact");
  return replace(stateDir, { ...record, artifacts: [...record.artifacts, { ...input, created_at: createdAt }], updated_at: createdAt });
}
