import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { HandoffId } from "./checkCompletionMatrix";
import {
  captureAgyResponse,
  captureCodexResponse,
  captureOpenRouterResponse,
  assertOpenRouterAccessTierOptions,
  assertOpenRouterPromptIsSendable,
  incrementOpenRouterAttemptBudget,
  openRouterErrorReason,
  redactOpenRouterApiKey,
  resolveOpenRouterModel,
  type CodexDispatchMode,
  type OpenRouterAttemptCounts,
  type OpenRouterMode,
  type OpenRouterModel,
  writePromptFile
} from "./cliWorkerCapture";
import { CLI_CALL_TELEMETRY_PATH, SESSION_LOCK_PATH } from "./sessionState";
import {
  writeCorrelationEntry,
  writeSubagentEvidence
} from "./subagentEvidence";
import {
  createAlert,
  type AlertTrigger,
  writePendingSupervisorAlert
} from "./supervisorAlerts";

// ─── Vendor types ─────────────────────────────────────────────────────────────

export type CliVendor = "codex_cli" | "agy_cli" | "openrouter_api";

export type { CodexDispatchMode, OpenRouterMode };

export type CliWorkerFailureSignal =
  | "timeout"
  | "auth_error"
  | "empty_output"
  | "invalid_json"
  | "non_zero_exit";

export type CliWorkerOutcome = "success" | CliWorkerFailureSignal;

export type CliWorkerTelemetryOutcome = CliWorkerOutcome | "already_locked";

export type CliWorkerTokenSource =
  | "provider_reported"
  | "estimated_tokenizer"
  | "estimated_chars";

export interface CliWorkerOutcomeInput {
  readonly exitCode: number;
  readonly rawOutput: string;
  readonly parsedJson: unknown;
  readonly structuredOutputRequested: boolean;
  readonly errorText?: string | null;
  readonly timedOut?: boolean;
}

export interface CliWorkerOutcomeClassification {
  readonly outcome: CliWorkerOutcome;
  readonly errorReason: string | null;
  readonly failure_signals: readonly CliWorkerFailureSignal[];
}

export interface CliWorkerProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
}

export interface CliCallTelemetryRecord {
  readonly schema_version: "v1";
  readonly recorded_at: string;
  readonly worker_run_id: string;
  readonly handoff_id: HandoffId;
  readonly vendor: CliVendor;
  readonly provider: "openai_gpt" | "gemini_cli" | "openrouter";
  readonly model: string | null;
  readonly tier_id: string | null;
  readonly input_chars: number;
  readonly output_chars: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly token_source: CliWorkerTokenSource;
  readonly duration_seconds: number;
  readonly exit_code: number;
  readonly lock_status: CliWorkerResult["lockStatus"];
  readonly outcome: CliWorkerTelemetryOutcome;
  readonly failure_signals: readonly CliWorkerFailureSignal[];
  readonly error_reason: string | null;
  readonly parsed_json_present: boolean;
  readonly codex_mode?: CodexDispatchMode;
  readonly openrouter_mode?: OpenRouterMode;
  readonly task_packet_ref?: string;
  readonly attempt_counts?: OpenRouterAttemptCounts;
}

export interface BuildCliCallTelemetryRecordInput {
  readonly recordedAt: string;
  readonly workerRunId: string;
  readonly handoffId: HandoffId;
  readonly vendor: CliVendor;
  readonly model: string | null;
  readonly tierId: string | null;
  readonly prompt: string;
  readonly rawOutput: string;
  readonly durationSeconds: number;
  readonly exitCode: number;
  readonly lockStatus: CliWorkerResult["lockStatus"];
  readonly outcome: CliWorkerTelemetryOutcome;
  readonly failureSignals: readonly CliWorkerFailureSignal[];
  readonly errorReason: string | null;
  readonly parsedJson: unknown;
  readonly providerUsage?: CliWorkerProviderUsage;
  readonly codexMode?: CodexDispatchMode;
  readonly openrouterMode?: OpenRouterMode;
  readonly taskPacketRef?: string;
  readonly attemptCounts?: OpenRouterAttemptCounts;
}

const AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  /\b(?:unauthorized|forbidden|not logged in|login required|please log in)\b/i,
  /\b(?:invalid|missing|expired)\s+(?:api\s+key|token|credential|credentials)\b/i,
  /\b(?:api\s+key|token|credential|credentials)\s+(?:invalid|missing|expired|required)\b/i,
  /\b(?:auth|authentication|authorization|oauth)\b[^\n]{0,80}\b(?:failed|failure|required|expired|missing|invalid|error)\b/i
];

const TIMEOUT_PATTERNS: readonly RegExp[] = [
  /\b(?:timed out|timeout|etimedout)\b/i
];

export function classifyCliWorkerOutcome(input: CliWorkerOutcomeInput): CliWorkerOutcomeClassification {
  const failureSignals: CliWorkerFailureSignal[] = [];
  const rawOutput = input.rawOutput ?? "";
  const diagnosticText = `${input.errorText ?? ""}\n${rawOutput}`;

  if (input.timedOut === true || matchesAny(diagnosticText, TIMEOUT_PATTERNS)) {
    failureSignals.push("timeout");
  }

  if (matchesAny(diagnosticText, AUTH_ERROR_PATTERNS)) {
    failureSignals.push("auth_error");
  }

  if (rawOutput.trim() === "") {
    failureSignals.push("empty_output");
  }

  if (input.structuredOutputRequested && input.parsedJson == null) {
    failureSignals.push("invalid_json");
  }

  if (input.exitCode !== 0) {
    failureSignals.push("non_zero_exit");
  }

  if (failureSignals.length === 0) {
    return {
      outcome: "success",
      errorReason: null,
      failure_signals: []
    };
  }

  const outcome = failureSignals[0] ?? "non_zero_exit";

  return {
    outcome,
    errorReason: errorReasonForOutcome(outcome, input),
    failure_signals: failureSignals
  };
}

export function alertTriggersForCliWorkerOutcome(
  classification: CliWorkerOutcomeClassification
): readonly AlertTrigger[] {
  return classification.failure_signals.map((signal) => signalToAlertTrigger(signal));
}

export function estimateCliWorkerTokens(text: string): number {
  const utf8Bytes = Buffer.byteLength(text, "utf8");
  const wordLikeCount = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  return Math.ceil(Math.max(utf8Bytes / 4, wordLikeCount * 1.3));
}

export function buildCliCallTelemetryRecord(input: BuildCliCallTelemetryRecordInput): CliCallTelemetryRecord {
  const providerUsage = input.providerUsage;
  const inputTokens = providerUsage ? safeTelemetryTokenCount(providerUsage.inputTokens) : estimateCliWorkerTokens(input.prompt);
  const outputTokens = providerUsage ? safeTelemetryTokenCount(providerUsage.outputTokens) : estimateCliWorkerTokens(input.rawOutput);
  const totalTokens = providerUsage
    ? safeTelemetryTokenCount(providerUsage.totalTokens ?? inputTokens + outputTokens)
    : inputTokens + outputTokens;

  return {
    schema_version: "v1",
    recorded_at: input.recordedAt,
    worker_run_id: input.workerRunId,
    handoff_id: input.handoffId,
    vendor: input.vendor,
    provider: providerForCliVendor(input.vendor),
    model: input.model,
    tier_id: input.tierId,
    input_chars: input.prompt.length,
    output_chars: input.rawOutput.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    token_source: providerUsage ? "provider_reported" : "estimated_chars",
    duration_seconds: input.durationSeconds,
    exit_code: input.exitCode,
    lock_status: input.lockStatus,
    outcome: input.outcome,
    failure_signals: [...input.failureSignals],
    error_reason: input.errorReason,
    parsed_json_present: input.parsedJson != null,
    ...(input.codexMode !== undefined ? { codex_mode: input.codexMode } : {}),
    ...(input.openrouterMode !== undefined ? { openrouter_mode: input.openrouterMode } : {}),
    ...(input.taskPacketRef !== undefined ? { task_packet_ref: input.taskPacketRef } : {}),
    ...(input.attemptCounts !== undefined ? { attempt_counts: input.attemptCounts } : {})
  };
}

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
  return stateFilePath(stateDir, SESSION_LOCK_PATH);
}

export function isWorkerLockStale(lock: WorkerLockRecord): boolean {
  const startedMs = new Date(lock.started_at).getTime();
  if (!Number.isFinite(startedMs) || typeof lock.ttl_minutes !== "number" || !Number.isFinite(lock.ttl_minutes)) {
    return true;
  }

  const ttlMs = lock.ttl_minutes * 60 * 1000;
  if (ttlMs <= 0) {
    return true;
  }

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
  const prefix = prefixForCliVendor(vendor);
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "T")
    .slice(0, 15); // YYYYMMDDTHHmmss
  return `${prefix}-${handoffSlug}-${ts}`;
}

function prefixForCliVendor(vendor: CliVendor): string {
  switch (vendor) {
    case "codex_cli":
      return "cli-codex";
    case "agy_cli":
      return "cli-agy";
    case "openrouter_api":
      return "cli-openrouter";
  }
}

// ─── runCliWorker ─────────────────────────────────────────────────────────────

export interface CliWorkerInput {
  readonly handoffId: HandoffId;
  readonly vendor: CliVendor;
  /** Prompt / handoff text to send to the worker. Must be redacted of secrets. */
  readonly prompt: string;
  /** Optional JSON schema path for Codex structured output enforcement. */
  readonly outputSchemaPath?: string;
  /** Named governed Codex dispatch mode. Absent preserves the legacy command config. */
  readonly codexMode?: CodexDispatchMode;
  /** Required for openrouter_api; selects the compiled-in free-model worker role. */
  readonly openrouterMode?: OpenRouterMode;
  /** Required for codex_implement; links the write-capable worker to its bounded packet. */
  readonly taskPacketRef?: string;
  readonly model?: string;
  readonly parentSessionHash: string;
  readonly parentTurnHash: string;
  readonly timeoutMs?: number;
  /** Working directory for the worker (the repo root) — gives the vendor REAL repo access. */
  readonly cwd?: string;
  /** Extra directories to grant the worker (agy --add-dir). */
  readonly addDirs?: readonly string[];
  /** Image files to attach to the prompt (codex exec -i; agy via the image's dir). */
  readonly images?: readonly string[];
  /** Fail fast before forwarding oversized handoff prompts to a vendor CLI. */
  readonly maxPromptChars?: number;
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
  readonly missing?: {
    readonly status: "MISSING";
    readonly provider: "openrouter";
    readonly reason: "openrouter_api_key_missing";
  };
}

export async function runCliWorker(
  input: CliWorkerInput,
  stateDir: string
): Promise<CliWorkerResult> {
  assertCodexDispatchGuard(input);
  const openRouterConfig = input.vendor === "openrouter_api" ? resolveOpenRouterWorkerConfig(input) : null;
  const taskPacketRef = normalizeTaskPacketRef(input.taskPacketRef);
  const modelForRun = openRouterConfig?.model ?? input.model ?? null;
  const handoffSlug = (input.handoffId as string).replace(/^hp-/, "hp-");
  const workerRunId = buildWorkerRunId(input.vendor, handoffSlug);
  const startedAt = new Date().toISOString();
  const promptLimitOptions = promptLimitOptionsFor(input);

  // Write handoff prompt to temp file (artifact pointer for evidence)
  const handoffFilePath = writePromptFile(input.prompt, handoffSlug, promptLimitOptions);

  // Acquire lock
  const lockRecord: WorkerLockRecord = {
    schema_version: "v1",
    worker_run_id: workerRunId,
    handoff_id: input.handoffId,
    vendor: input.vendor,
    model: modelForRun,
    pid: null,
    started_at: startedAt,
    lock_source: "supervisor_spawn",
    ttl_minutes: 30
  };

  const lockStatus = acquireWorkerLock(lockRecord, stateDir);
  if (lockStatus === "already_locked") {
    const busyErrorReason = "worker_busy: another worker holds the lock";
    emitSupervisorAlert("already_locked", {
      input,
      workerRunId,
      model: modelForRun,
      lockStatus: "already_locked",
      errorReason: busyErrorReason
    }, stateDir);
    writeCliCallTelemetryRecord(buildCliCallTelemetryRecord({
      recordedAt: new Date().toISOString(),
      workerRunId,
      handoffId: input.handoffId,
      vendor: input.vendor,
      model: modelForRun,
      tierId: null,
      prompt: input.prompt,
      rawOutput: "",
      durationSeconds: 0,
      exitCode: -1,
      lockStatus: "already_locked",
      outcome: "already_locked",
      failureSignals: [],
      errorReason: busyErrorReason,
      parsedJson: null,
      ...(input.codexMode !== undefined ? { codexMode: input.codexMode } : {}),
      ...(openRouterConfig !== null ? { openrouterMode: openRouterConfig.openrouterMode } : {}),
      ...(taskPacketRef !== undefined ? { taskPacketRef } : {})
    }), stateDir);

    return {
      workerRunId,
      handoffId: input.handoffId,
      vendor: input.vendor,
      model: modelForRun,
      exitCode: -1,
      rawOutput: "",
      parsedJson: null,
      durationSeconds: 0,
      lockStatus: "already_locked",
      workerOutputPath: null,
      errorReason: busyErrorReason
    };
  }

  if (lockStatus === "stale_replaced") {
    emitSupervisorAlert("lock_stale_replaced", {
      input,
      workerRunId,
      model: modelForRun,
      lockStatus,
      errorReason: "lock_stale_replaced: stale worker lock was replaced"
    }, stateDir);
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
  let captureErrorText: string | null = null;
  let captureTimedOut = false;
  let openRouterAttemptCounts: OpenRouterAttemptCounts | undefined;
  let missing: CliWorkerResult["missing"] | undefined;
  let providerUsage: CliWorkerProviderUsage | undefined;

  try {
    if (input.vendor === "agy_cli") {
      const result = await captureAgyResponse(input.prompt, {
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.addDirs !== undefined ? { addDirs: input.addDirs } : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...promptLimitOptions
      });
      exitCode = result.exitCode;
      rawOutput = result.cleanOutput;
      parsedJson = result.parsedJson;
      durationSeconds = result.durationMs / 1000;

      // Persist the clean output to a file as the worker_output artifact
      workerOutputPath = writeResponseFile(result.cleanOutput, workerRunId, stateDir);
    } else if (input.vendor === "openrouter_api") {
      if (openRouterConfig === null) {
        throw new Error("openrouter_api internal error: missing resolved config");
      }

      const result = await captureOpenRouterResponse(input.prompt, {
        openrouterMode: openRouterConfig.openrouterMode,
        model: openRouterConfig.model,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...promptLimitOptions,
        recordAttempt: () => {
          try {
            const counts = incrementOpenRouterAttemptBudget({
              stateDir,
              openrouterMode: openRouterConfig.openrouterMode,
              model: openRouterConfig.model,
              taskPacketRef: openRouterConfig.taskPacketRef
            });
            openRouterAttemptCounts = counts;
            return counts;
          } catch (err) {
            const counts = attemptCountsFromError(err);
            if (counts) {
              openRouterAttemptCounts = counts;
            }
            throw err;
          }
        }
      });
      exitCode = result.exitCode;
      rawOutput = result.rawOutput;
      parsedJson = result.parsedJson;
      durationSeconds = result.durationMs / 1000;
      captureErrorText = result.errorOutput;
      captureTimedOut = result.timedOut;
      openRouterAttemptCounts = result.attemptCounts ?? openRouterAttemptCounts;
      providerUsage = result.providerUsage;
      missing = result.missing;

      if (!result.missing) {
        workerOutputPath = writeResponseFile(result.rawOutput, workerRunId, stateDir);
      }
    } else {
      const result = await captureCodexResponse(input.prompt, {
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.outputSchemaPath !== undefined ? { outputSchemaPath: input.outputSchemaPath } : {}),
        ...(input.codexMode !== undefined ? { codexMode: input.codexMode } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.addDirs !== undefined ? { addDirs: input.addDirs } : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...promptLimitOptions
      });
      exitCode = result.exitCode;
      rawOutput = result.rawFileContent;
      parsedJson = result.parsedJson;
      durationSeconds = result.durationMs / 1000;
      workerOutputPath = result.outputFilePath;
      captureErrorText = result.errorOutput;
      captureTimedOut = result.timedOut;
    }
  } catch (err) {
    captureErrorText = sanitizeCaptureErrorText(err, input.vendor);
  }

  const classification = classifyCliWorkerOutcome({
    exitCode,
    rawOutput,
    parsedJson,
    structuredOutputRequested: input.outputSchemaPath !== undefined,
    errorText: captureErrorText,
    timedOut: captureTimedOut
  });
  errorReason = input.vendor === "openrouter_api" && captureErrorText
    ? captureErrorText
    : classification.errorReason;

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

  writeCliCallTelemetryRecord(buildCliCallTelemetryRecord({
    recordedAt: stoppedAt,
    workerRunId,
    handoffId: input.handoffId,
    vendor: input.vendor,
    model: modelForRun,
    tierId: null,
    prompt: input.prompt,
    rawOutput,
    durationSeconds,
    exitCode,
    lockStatus,
    outcome: classification.outcome,
    failureSignals: classification.failure_signals,
    errorReason,
    parsedJson,
    ...(providerUsage !== undefined ? { providerUsage } : {}),
    ...(input.codexMode !== undefined ? { codexMode: input.codexMode } : {}),
    ...(openRouterConfig !== null ? { openrouterMode: openRouterConfig.openrouterMode } : {}),
    ...(taskPacketRef !== undefined ? { taskPacketRef } : {}),
    ...(openRouterAttemptCounts !== undefined ? { attemptCounts: openRouterAttemptCounts } : {})
  }), stateDir);

  for (const trigger of alertTriggersForCliWorkerOutcome(classification)) {
    emitSupervisorAlert(trigger, {
      input,
      workerRunId,
      model: modelForRun,
      lockStatus,
      errorReason
    }, stateDir);
  }

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
  const subagentEvidenceRecord = {
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
    recorded_at: stoppedAt,
    ...(modelForRun !== null ? { model: modelForRun } : {}),
    ...(errorReason !== null ? { error_reason: errorReason } : {}),
    ...(input.codexMode !== undefined ? { codex_mode: input.codexMode } : {}),
    ...(openRouterConfig !== null ? { openrouter_mode: openRouterConfig.openrouterMode } : {}),
    ...(taskPacketRef !== undefined ? { task_packet_ref: taskPacketRef } : {}),
    ...(openRouterAttemptCounts !== undefined ? { attempt_counts: openRouterAttemptCounts } : {}),
    ...(missing !== undefined ? { missing } : {})
  };
  writeSubagentEvidence(
    subagentEvidenceRecord,
    stateDir
  );

  return {
    workerRunId,
    handoffId: input.handoffId,
    vendor: input.vendor,
    model: modelForRun,
    exitCode,
    rawOutput,
    parsedJson,
    durationSeconds,
    lockStatus,
    workerOutputPath,
    errorReason,
    ...(missing !== undefined ? { missing } : {})
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function promptLimitOptionsFor(input: Pick<CliWorkerInput, "maxPromptChars">): { readonly maxPromptChars?: number } {
  return input.maxPromptChars === undefined ? {} : { maxPromptChars: input.maxPromptChars };
}

function assertCodexDispatchGuard(input: CliWorkerInput): void {
  if (
    input.vendor === "codex_cli" &&
    input.codexMode === "codex_implement" &&
    normalizeTaskPacketRef(input.taskPacketRef) === undefined
  ) {
    throw new Error("codex_implement requires taskPacketRef — bounded worker doctrine");
  }
}

interface OpenRouterWorkerConfig {
  readonly openrouterMode: OpenRouterMode;
  readonly model: OpenRouterModel;
  readonly taskPacketRef: string;
}

function resolveOpenRouterWorkerConfig(input: CliWorkerInput): OpenRouterWorkerConfig {
  if (input.openrouterMode === undefined) {
    throw new Error("openrouter_api requires openrouterMode - bounded worker doctrine");
  }

  const taskPacketRef = normalizeTaskPacketRef(input.taskPacketRef);
  if (taskPacketRef === undefined) {
    throw new Error("openrouter_api requires taskPacketRef - bounded worker doctrine");
  }

  assertOpenRouterAccessTierOptions(input as unknown as Record<string, unknown>);
  const model = resolveOpenRouterModel(input.openrouterMode, input.model);
  assertOpenRouterPromptIsSendable(input.prompt);

  return {
    openrouterMode: input.openrouterMode,
    model,
    taskPacketRef
  };
}

function normalizeTaskPacketRef(taskPacketRef: string | undefined): string | undefined {
  const trimmed = taskPacketRef?.trim();
  return trimmed ? trimmed : undefined;
}

function attemptCountsFromError(err: unknown): OpenRouterAttemptCounts | undefined {
  if (!err || typeof err !== "object" || !("attemptCounts" in err)) {
    return undefined;
  }

  const attemptCounts = (err as { readonly attemptCounts?: unknown }).attemptCounts;
  if (!attemptCounts || typeof attemptCounts !== "object") {
    return undefined;
  }

  return attemptCounts as OpenRouterAttemptCounts;
}

function sanitizeCaptureErrorText(err: unknown, vendor: CliVendor): string {
  const raw = vendor === "openrouter_api"
    ? openRouterErrorReason(err) ?? errorText(err)
    : errorText(err);

  return vendor === "openrouter_api" ? redactOpenRouterApiKey(raw) : raw;
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }

  return String(err);
}

function appendRegistryEntry(entry: Record<string, unknown>, stateDir: string): void {
  const path = join(stateDir, "agent-registry.jsonl");
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function writeResponseFile(content: string, runId: string, stateDir: string): string {
  const path = join(stateDir, `${runId}-output.txt`);
  writeFileSync(path, content, "utf8");
  return path;
}

function errorReasonForOutcome(outcome: CliWorkerFailureSignal, input: CliWorkerOutcomeInput): string {
  switch (outcome) {
    case "timeout":
      return "timeout: worker capture timed out";
    case "auth_error":
      return "auth_error: worker output indicates authentication failure";
    case "empty_output":
      return "empty_output: worker produced no output";
    case "invalid_json":
      return "invalid_json: structured output requested but parsed JSON is absent";
    case "non_zero_exit":
      return `non_zero_exit: worker exited with code ${input.exitCode}`;
  }
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function signalToAlertTrigger(signal: CliWorkerFailureSignal): AlertTrigger {
  switch (signal) {
    case "timeout":
      return "timeout";
    case "auth_error":
      return "auth_error";
    case "empty_output":
      return "empty_output";
    case "invalid_json":
      return "invalid_json";
    case "non_zero_exit":
      return "non_zero_exit";
  }
}

function providerForCliVendor(vendor: CliVendor): "openai_gpt" | "gemini_cli" | "openrouter" {
  switch (vendor) {
    case "codex_cli":
      return "openai_gpt";
    case "agy_cli":
      return "gemini_cli";
    case "openrouter_api":
      return "openrouter";
  }
}

function safeTelemetryTokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

function writeCliCallTelemetryRecord(record: CliCallTelemetryRecord, stateDir: string): void {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(stateFilePath(stateDir, CLI_CALL_TELEMETRY_PATH), `${JSON.stringify(record)}\n`, "utf8");
}

function emitSupervisorAlert(
  trigger: AlertTrigger,
  context: {
    readonly input: CliWorkerInput;
    readonly workerRunId: string;
    readonly model: string | null;
    readonly lockStatus: CliWorkerResult["lockStatus"];
    readonly errorReason: string | null;
  },
  stateDir: string
): void {
  const alert = createAlert(
    trigger,
    [
      `handoff_id=${context.input.handoffId as string}`,
      `worker_run_id=${context.workerRunId}`,
      `vendor=${context.input.vendor}`,
      `model=${context.model ?? "default"}`,
      `lock_status=${context.lockStatus}`,
      `error_reason=${context.errorReason ?? "none"}`
    ].join(" "),
    providerForCliVendor(context.input.vendor)
  );

  writePendingSupervisorAlert(alert, stateDir);
}

function stateFilePath(stateDir: string, path: string): string {
  const fileName = path.split(/[\\/]/).at(-1) ?? path;
  return join(stateDir, fileName);
}
