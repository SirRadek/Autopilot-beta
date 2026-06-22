import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { HandoffId } from "./checkCompletionMatrix";
import {
  captureAgyResponse,
  captureCodexResponse,
  writePromptFile
} from "./cliWorkerCapture";
import { SESSION_LOCK_PATH } from "./sessionState";
import {
  writeCorrelationEntry,
  writeSubagentEvidence
} from "./subagentEvidence";

// ─── Vendor types ─────────────────────────────────────────────────────────────

export type CliVendor = "codex_cli" | "agy_cli";

// ─── Worker lock ─────────────────────────────────────────────────────────────

export interface WorkerLockRecord {
  readonly schema_version: "v1";
  readonly worker_run_id: string;
  readonly handoff_id: HandoffId;
  readonly vendor: CliVendor;
  readonly model: string | null;
  readonly pid: number | null;
  readonly started_at: string;
  readonly lock_source: "supervisor_spawn";
  readonly ttl_minutes: number;
}

function lockFilePath(stateDir: string): string {
  const fileName = SESSION_LOCK_PATH.split(/[\\/]/).at(-1) ?? "worker.lock";
  return join(stateDir, fileName);
}

export function isWorkerLockStale(lock: WorkerLockRecord): boolean {
  const startedMs = new Date(lock.started_at).getTime();
  const ttlMs = lock.ttl_minutes * 60 * 1000;
  return Date.now() - startedMs > ttlMs;
}

export function readWorkerLock(stateDir: string): WorkerLockRecord | null {
  const path = lockFilePath(stateDir);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as WorkerLockRecord;
  } catch {
    return null;
  }
}

export function acquireWorkerLock(
  lock: WorkerLockRecord,
  stateDir: string
): "acquired_supervisor_spawn" | "already_locked" | "stale_replaced" {
  mkdirSync(stateDir, { recursive: true });
  const existing = readWorkerLock(stateDir);

  if (existing) {
    if (!isWorkerLockStale(existing)) {
      return "already_locked";
    }
    writeFileSync(lockFilePath(stateDir), JSON.stringify(lock, null, 2), "utf8");
    return "stale_replaced";
  }

  writeFileSync(lockFilePath(stateDir), JSON.stringify(lock, null, 2), "utf8");
  return "acquired_supervisor_spawn";
}

export function releaseWorkerLock(workerRunId: string, stateDir: string): void {
  const existing = readWorkerLock(stateDir);
  if (existing?.worker_run_id === workerRunId) {
    try {
      unlinkSync(lockFilePath(stateDir));
    } catch {
      // already gone
    }
  }
}

// ─── Worker run ID ────────────────────────────────────────────────────────────

export function buildWorkerRunId(vendor: CliVendor, handoffSlug: string): string {
  const prefix = vendor === "codex_cli" ? "cli-codex" : "cli-agy";
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "T")
    .slice(0, 15); // YYYYMMDDTHHmmss
  return `${prefix}-${handoffSlug}-${ts}`;
}

// ─── runCliWorker ─────────────────────────────────────────────────────────────

export interface CliWorkerInput {
  readonly handoffId: HandoffId;
  readonly vendor: CliVendor;
  /** Prompt / handoff text to send to the worker. Must be redacted of secrets. */
  readonly prompt: string;
  /** Optional JSON schema path for Codex structured output enforcement. */
  readonly outputSchemaPath?: string;
  readonly model?: string;
  readonly parentSessionHash: string;
  readonly parentTurnHash: string;
  readonly timeoutMs?: number;
}

export interface CliWorkerResult {
  readonly workerRunId: string;
  readonly handoffId: HandoffId;
  readonly vendor: CliVendor;
  readonly model: string | null;
  readonly exitCode: number;
  readonly rawOutput: string;
  readonly parsedJson: unknown;
  readonly durationSeconds: number;
  readonly lockStatus: "acquired_supervisor_spawn" | "already_locked" | "stale_replaced" | "failed";
  readonly workerOutputPath: string | null;
  readonly errorReason: string | null;
}

export async function runCliWorker(
  input: CliWorkerInput,
  stateDir: string
): Promise<CliWorkerResult> {
  const handoffSlug = (input.handoffId as string).replace(/^hp-/, "hp-");
  const workerRunId = buildWorkerRunId(input.vendor, handoffSlug);
  const startedAt = new Date().toISOString();

  // Write handoff prompt to temp file (artifact pointer for evidence)
  const handoffFilePath = writePromptFile(input.prompt, handoffSlug);

  // Acquire lock
  const lockRecord: WorkerLockRecord = {
    schema_version: "v1",
    worker_run_id: workerRunId,
    handoff_id: input.handoffId,
    vendor: input.vendor,
    model: input.model ?? null,
    pid: null,
    started_at: startedAt,
    lock_source: "supervisor_spawn",
    ttl_minutes: 30
  };

  const lockStatus = acquireWorkerLock(lockRecord, stateDir);
  if (lockStatus === "already_locked") {
    return {
      workerRunId,
      handoffId: input.handoffId,
      vendor: input.vendor,
      model: input.model ?? null,
      exitCode: -1,
      rawOutput: "",
      parsedJson: null,
      durationSeconds: 0,
      lockStatus: "already_locked",
      workerOutputPath: null,
      errorReason: "worker_busy: another worker holds the lock"
    };
  }

  // Write agent-registry start entry
  const registryStart = {
    schema_version: "v1" as const,
    event: "subagent_start" as const,
    agent_id: workerRunId,
    agent_type: `${input.vendor}-external` as string,
    parent_session_hash: input.parentSessionHash,
    parent_turn_hash: input.parentTurnHash,
    started_at: startedAt,
    source: "supervisor_spawn"
  };
  appendRegistryEntry(registryStart, stateDir);

  let exitCode = 1;
  let rawOutput = "";
  let parsedJson: unknown = null;
  let durationSeconds = 0;
  let workerOutputPath: string | null = null;
  let errorReason: string | null = null;

  try {
    if (input.vendor === "agy_cli") {
      const result = await captureAgyResponse(input.prompt, {
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {})
      });
      exitCode = result.exitCode;
      rawOutput = result.cleanOutput;
      parsedJson = result.parsedJson;
      durationSeconds = result.durationMs / 1000;

      // Persist the clean output to a file as the worker_output artifact
      workerOutputPath = writeResponseFile(result.cleanOutput, workerRunId, stateDir);
    } else {
      const result = await captureCodexResponse(input.prompt, {
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.outputSchemaPath !== undefined ? { outputSchemaPath: input.outputSchemaPath } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {})
      });
      exitCode = result.exitCode;
      rawOutput = result.rawFileContent;
      parsedJson = result.parsedJson;
      durationSeconds = result.durationMs / 1000;
      workerOutputPath = result.outputFilePath;
    }

    // Detect output errors even on exit 0 (agy exits 0 on model failures)
    if (!rawOutput || rawOutput.trim() === "") {
      errorReason = "empty_output: worker produced no output";
    }
  } catch (err) {
    errorReason = err instanceof Error ? err.message : String(err);
  }

  const stoppedAt = new Date().toISOString();

  // Release lock
  releaseWorkerLock(workerRunId, stateDir);

  // Write agent-registry stop entry
  const registryStop = {
    schema_version: "v1" as const,
    event: "subagent_stop" as const,
    agent_id: workerRunId,
    stopped_at: stoppedAt,
    exit_code: exitCode,
    source: "supervisor_spawn"
  };
  appendRegistryEntry(registryStop, stateDir);

  // Write handoff correlation
  writeCorrelationEntry(
    {
      agent_id: workerRunId,
      handoff_id: input.handoffId,
      correlated_at: stoppedAt,
      source: "supervisor_assignment"
    },
    stateDir
  );

  // Write subagent evidence
  writeSubagentEvidence(
    {
      handoff_id: input.handoffId,
      agent_id: workerRunId,
      agent_type: `${input.vendor}-external`,
      parent_session_hash: input.parentSessionHash,
      started_at: startedAt,
      stopped_at: stoppedAt,
      duration_seconds: Math.round(durationSeconds),
      artifacts: {
        handoff_packet: handoffFilePath,
        worker_output: workerOutputPath ?? "",
        reviewer_output: null
      },
      lock_status: lockStatus,
      verified: false,
      recorded_at: stoppedAt
    },
    stateDir
  );

  return {
    workerRunId,
    handoffId: input.handoffId,
    vendor: input.vendor,
    model: input.model ?? null,
    exitCode,
    rawOutput,
    parsedJson,
    durationSeconds,
    lockStatus,
    workerOutputPath,
    errorReason
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function appendRegistryEntry(entry: Record<string, unknown>, stateDir: string): void {
  const path = join(stateDir, "agent-registry.jsonl");
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function writeResponseFile(content: string, runId: string, stateDir: string): string {
  const path = join(stateDir, `${runId}-output.txt`);
  writeFileSync(path, content, "utf8");
  return path;
}
