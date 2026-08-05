import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import type { HandoffId } from "./checkCompletionMatrix";
import {
  captureAgyResponse,
  captureCodexResponse,
  captureClaudeResponse,
  captureOpenRouterResponse,
  assertOpenRouterAccessTierOptions,
  assertOpenRouterDailySpendBudgetAvailable,
  assertOpenRouterPromptIsSendable,
  buildVendorProcessRecord,
  DEFAULT_VENDOR_PROCESS_MAX_AGE_MS,
  incrementOpenRouterAttemptBudget,
  killVendorProcess,
  openRouterErrorReason,
  openRouterSpendLedgerPathForStateDir,
  parseVendorProcessRegistryLines,
  redactOpenRouterApiKey,
  resolveCodexDispatchConfig,
  resolveOpenRouterModel,
  selectOrphanedVendorPids,
  sweepStaleVendorArtifactDirectories,
  type CodexDispatchMode,
  type OpenRouterAttemptCounts,
  type OpenRouterMode,
  type OpenRouterModel,
  type VendorProcessRecord,
  writePromptFile
} from "./cliWorkerCapture";
import { CLI_CALL_TELEMETRY_PATH, SESSION_LOCK_PATH, VENDOR_PROCESS_REGISTRY_PATH } from "./sessionState";
import { appendStateFile, removeStateFile, withStateMaintenanceLock, writeStateFileAtomically } from "./stateMaintenanceLock";
import { parseSanitizedWorkerJson, sanitizeWorkerError, sanitizeWorkerOutput } from "./workerOutputPolicy";
import { recordOperationalIncident } from "./operationalIncidents";
import { ensureOpenRouterLedgersMigrated } from "./openRouterLedgerMigration";
import type { RoutingModeId } from "./routingModes";
import { SUPPORTED_REASONING_EFFORTS, type RunReasoningEffort } from "./executionProfile";
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

export type CliVendor = "codex_cli" | "claude_cli" | "agy_cli" | "openrouter_api";

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

/** Runtime generation settings supplied by a model adapter and recorded for tuning. */
export interface ModelGenerationSettings {
  readonly temperature?: number;
  readonly top_p?: number;
  readonly top_k?: number;
  readonly min_p?: number;
  readonly max_output_tokens?: number;
  readonly reasoning_effort?: string;
  readonly speculative_decoding?: {
    readonly type: string;
    readonly draft_length?: number;
  };
}

/** Adapter-enforced controls recorded separately from model sampling settings. */
export interface ModelGovernanceSettings {
  readonly sandbox?: string;
  readonly approval_policy?: string;
  readonly web_search?: boolean;
  readonly allow_fallbacks?: boolean;
  readonly max_price?: {
    readonly prompt: number;
    readonly completion: number;
    readonly request: number;
  };
}

export interface CliCallTelemetryRecord {
  readonly schema_version: "v1";
  readonly recorded_at: string;
  readonly worker_run_id: string;
  readonly handoff_id: HandoffId;
  readonly session_id?: string;
  readonly skill_ids?: readonly string[];
  readonly vendor: CliVendor;
  readonly provider: "openai_gpt" | "anthropic_claude" | "gemini_cli" | "openrouter";
  readonly model: string | null;
  readonly tier_id: string | null;
  readonly input_chars: number;
  readonly output_chars: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly token_source: CliWorkerTokenSource;
  readonly lock_source: string;
  readonly duration_seconds: number;
  readonly attempt_count: number;
  readonly exit_code: number;
  readonly lock_status: CliWorkerResult["lockStatus"];
  readonly outcome: CliWorkerTelemetryOutcome;
  readonly failure_signals: readonly CliWorkerFailureSignal[];
  readonly error_reason: string | null;
  readonly parsed_json_present: boolean;
  readonly codex_mode?: CodexDispatchMode;
  readonly openrouter_mode?: OpenRouterMode;
  readonly routing_mode?: RoutingModeId;
  readonly task_packet_ref?: string;
  readonly attempt_counts?: OpenRouterAttemptCounts;
  readonly generation_settings?: ModelGenerationSettings;
  readonly governance_settings?: ModelGovernanceSettings;
}

export interface BuildCliCallTelemetryRecordInput {
  readonly recordedAt: string;
  readonly workerRunId: string;
  readonly handoffId: HandoffId;
  readonly sessionId?: string;
  readonly skillIds?: readonly string[];
  readonly vendor: CliVendor;
  readonly model: string | null;
  readonly tierId: string | null;
  readonly prompt: string;
  readonly rawOutput: string;
  readonly durationSeconds: number;
  readonly attempt_count?: number;
  readonly exitCode: number;
  readonly lockStatus: CliWorkerResult["lockStatus"];
  readonly outcome: CliWorkerTelemetryOutcome;
  readonly failureSignals: readonly CliWorkerFailureSignal[];
  readonly errorReason: string | null;
  readonly parsedJson: unknown;
  readonly lockSource?: string;
  readonly providerUsage?: CliWorkerProviderUsage;
  readonly codexMode?: CodexDispatchMode;
  readonly openrouterMode?: OpenRouterMode;
  readonly routingMode?: RoutingModeId;
  readonly taskPacketRef?: string;
  readonly attemptCounts?: OpenRouterAttemptCounts;
  readonly generationSettings?: ModelGenerationSettings;
  readonly governanceSettings?: ModelGovernanceSettings;
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
    ...(input.sessionId !== undefined ? { session_id: input.sessionId } : {}),
    ...(input.skillIds !== undefined ? { skill_ids: [...input.skillIds] } : {}),
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
    lock_source: input.lockSource ?? "supervisor_spawn",
    duration_seconds: input.durationSeconds,
    attempt_count: input.attempt_count ?? 1,
    exit_code: input.exitCode,
    lock_status: input.lockStatus,
    outcome: input.outcome,
    failure_signals: [...input.failureSignals],
    error_reason: input.errorReason,
    parsed_json_present: input.parsedJson != null,
    ...(input.codexMode !== undefined ? { codex_mode: input.codexMode } : {}),
    ...(input.openrouterMode !== undefined ? { openrouter_mode: input.openrouterMode } : {}),
    ...(input.routingMode !== undefined ? { routing_mode: input.routingMode } : {}),
    ...(input.taskPacketRef !== undefined ? { task_packet_ref: input.taskPacketRef } : {}),
    ...(input.attemptCounts !== undefined ? { attempt_counts: input.attemptCounts } : {}),
    ...(input.generationSettings !== undefined ? { generation_settings: input.generationSettings } : {}),
    ...(input.governanceSettings !== undefined ? { governance_settings: input.governanceSettings } : {})
  };
}

// ─── Worker lock ─────────────────────────────────────────────────────────────

export const WORKER_LOCK_TTL_MINUTES = 30;

export interface WorkerLockRecord {
  readonly schema_version: "v1";
  readonly worker_run_id: string;
  readonly handoff_id: HandoffId;
  readonly vendor: CliVendor;
  readonly model: string | null;
  readonly pid: number | null;
  readonly started_at: string;
  readonly lock_source: string;
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
  return withStateMaintenanceLock(stateDir, () => {
    const existing = readWorkerLock(stateDir);
    if (existing) {
      if (!isWorkerLockStale(existing)) {
        return "already_locked";
      }
      writeStateFileAtomically(stateDir, lockFilePath(stateDir), JSON.stringify(lock, null, 2));
      return "stale_replaced";
    }
    writeStateFileAtomically(stateDir, lockFilePath(stateDir), JSON.stringify(lock, null, 2));
    return "acquired_supervisor_spawn";
  });
}

export function releaseWorkerLock(workerRunId: string, stateDir: string): void {
  withStateMaintenanceLock(stateDir, () => {
    const existing = readWorkerLock(stateDir);
    if (existing?.worker_run_id === workerRunId) {
      removeStateFile(stateDir, lockFilePath(stateDir));
    }
  });
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
    case "claude_cli":
      return "cli-claude";
    case "agy_cli":
      return "cli-agy";
    case "openrouter_api":
      return "cli-openrouter";
  }
}

// ─── runCliWorker ─────────────────────────────────────────────────────────────

export interface CliWorkerInput {
  readonly handoffId: HandoffId;
  readonly sessionId?: string;
  readonly skillIds?: readonly string[];
  readonly vendor: CliVendor;
  /** Prompt / handoff text to send to the worker. Must be redacted of secrets. */
  readonly prompt: string;
  /** Optional JSON schema path for Codex structured output enforcement. */
  readonly outputSchemaPath?: string;
  /** Named governed Codex dispatch mode. Absent preserves the legacy command config. */
  readonly codexMode?: CodexDispatchMode;
  /** Required for openrouter_api; selects the compiled-in free-model worker role. */
  readonly openrouterMode?: OpenRouterMode;
  /** Optional governed routing mode for redacted vendor-call telemetry. */
  readonly routingMode?: RoutingModeId;
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
  readonly lockSource?: string;
  /** Fail fast before forwarding oversized handoff prompts to a vendor CLI. */
  readonly maxPromptChars?: number;
  /** Optional adapter-supplied generation settings recorded for model tuning. */
  readonly generationSettings?: ModelGenerationSettings;
  /** When true, the supervisor owns the total retry budget. */
  readonly supervisorOwnsRetry?: boolean;
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
  assertCliWorkerRoute(input);
  sweepVendorArtifactsBestEffort();
  sweepVendorProcessRegistryBestEffort(stateDir);
  const openRouterConfig = input.vendor === "openrouter_api" ? resolveOpenRouterWorkerConfig(input) : null;
  const taskPacketRef = normalizeTaskPacketRef(input.taskPacketRef);
  const modelForRun = openRouterConfig?.model ?? input.model ?? null;
  const handoffSlug = (input.handoffId as string).replace(/^hp-/, "hp-");
  const workerRunId = buildWorkerRunId(input.vendor, handoffSlug);
  const startedAt = new Date().toISOString();
  const lockSource = input.lockSource ?? "supervisor_spawn";
  const promptLimitOptions = promptLimitOptionsFor(input);
  const governanceSettings = governanceSettingsFor(input.vendor, input.codexMode);

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
    lock_source: lockSource,
    ttl_minutes: WORKER_LOCK_TTL_MINUTES
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
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.skillIds !== undefined ? { skillIds: input.skillIds } : {}),
      vendor: input.vendor,
      model: modelForRun,
      tierId: null,
      prompt: input.prompt,
      rawOutput: "",
      durationSeconds: 0,
      attempt_count: 1,
      exitCode: -1,
      lockStatus: "already_locked",
      outcome: "already_locked",
      failureSignals: [],
      errorReason: busyErrorReason,
      parsedJson: null,
      lockSource,
      ...(input.codexMode !== undefined ? { codexMode: input.codexMode } : {}),
      ...(openRouterConfig !== null ? { openrouterMode: openRouterConfig.openrouterMode } : {}),
      ...(input.routingMode !== undefined ? { routingMode: input.routingMode } : {}),
      ...(taskPacketRef !== undefined ? { taskPacketRef } : {}),
      ...(input.generationSettings !== undefined ? { generationSettings: input.generationSettings } : {}),
      governanceSettings
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
  let attemptCount = 1;
  let workerOutputPath: string | null = null;
  let errorReason: string | null = null;
  let captureErrorText: string | null = null;
  let captureTimedOut = false;
  let openRouterAttemptCounts: OpenRouterAttemptCounts | undefined;
  let missing: CliWorkerResult["missing"] | undefined;
  let providerUsage: CliWorkerProviderUsage | undefined;
  let rawCapturePath: string | null = null;

  try {
    if (input.vendor === "claude_cli") {
      const result = await captureClaudeResponse(input.prompt, {
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.generationSettings?.reasoning_effort !== undefined ? { effort: input.generationSettings.reasoning_effort } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...promptLimitOptions,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {})
      });
      exitCode = result.exitCode;
      rawOutput = result.rawOutput;
      durationSeconds = result.durationMs / 1000;
      captureErrorText = result.errorOutput;
      captureTimedOut = result.timedOut;
    } else if (input.vendor === "agy_cli") {
      const result = await captureAgyResponse(input.prompt, {
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.generationSettings?.reasoning_effort !== undefined ? { effort: input.generationSettings.reasoning_effort } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.addDirs !== undefined ? { addDirs: input.addDirs } : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        workerRunId,
        onProcessEvent: (record) => appendBestEffort(
          stateFilePath(stateDir, VENDOR_PROCESS_REGISTRY_PATH),
          record
        ),
        ...promptLimitOptions
      });
      exitCode = result.exitCode;
      rawOutput = result.cleanOutput;
      parsedJson = result.parsedJson;
      durationSeconds = result.durationMs / 1000;
      attemptCount = 1;

    } else if (input.vendor === "openrouter_api") {
      if (openRouterConfig === null) {
        throw new Error("openrouter_api internal error: missing resolved config");
      }

      ensureOpenRouterLedgersMigrated(stateDir);
      const spendLedgerPath = openRouterSpendLedgerPathForStateDir(stateDir);
      const result = await captureOpenRouterResponse(input.prompt, {
        openrouterMode: openRouterConfig.openrouterMode,
        model: openRouterConfig.model,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...promptLimitOptions,
        spendLedgerPath,
        recordAttempt: () => {
          try {
            assertOpenRouterDailySpendBudgetAvailable({ spendLedgerPath });
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

    } else {
      const result = await captureCodexResponse(input.prompt, {
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.generationSettings?.reasoning_effort !== undefined ? { effort: input.generationSettings.reasoning_effort } : {}),
        ...(input.outputSchemaPath !== undefined ? { outputSchemaPath: input.outputSchemaPath } : {}),
        ...(input.codexMode !== undefined ? { codexMode: input.codexMode } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.addDirs !== undefined ? { addDirs: input.addDirs } : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.supervisorOwnsRetry !== undefined
          ? { supervisorOwnsRetry: input.supervisorOwnsRetry }
          : {}),
        ...promptLimitOptions
      });
      exitCode = result.exitCode;
      rawOutput = result.rawFileContent;
      parsedJson = result.parsedJson;
      durationSeconds = result.durationMs / 1000;
      attemptCount = result.attempts;
      rawCapturePath = result.outputFilePath;
      captureErrorText = result.errorOutput;
      captureTimedOut = result.timedOut;
    }
  } catch (err) {
    captureErrorText = sanitizeCaptureErrorText(err, input.vendor);
  }

  rawOutput = sanitizeWorkerOutput(rawOutput);
  parsedJson = sanitizeParsedWorkerJson(parsedJson);
  captureErrorText = sanitizeWorkerError(captureErrorText);
  try {
    if (rawOutput.length > 0 && missing === undefined) {
      workerOutputPath = writeResponseFile(rawOutput, workerRunId, stateDir);
    }
  } finally {
    if (rawCapturePath !== null) unlinkBestEffort(rawCapturePath);
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
  errorReason = sanitizeWorkerError(errorReason);

  if (
    classification.outcome !== "success"
    || rawOutput === "[REDACTION_FAILED]"
    || errorReason === "[REDACTION_FAILED]"
  ) {
    try {
      recordOperationalIncident(stateDir, {
        stage: "worker_output",
        correlation_ids: {
          worker_run_id: workerRunId,
          handoff_id: input.handoffId
        }
      });
    } catch {
      // Incident persistence must never replace the governed worker result.
    }
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

  writeCliCallTelemetryRecord(buildCliCallTelemetryRecord({
    recordedAt: stoppedAt,
    workerRunId,
    handoffId: input.handoffId,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.skillIds !== undefined ? { skillIds: input.skillIds } : {}),
    vendor: input.vendor,
    model: modelForRun,
    tierId: null,
    prompt: input.prompt,
    rawOutput,
    durationSeconds,
    attempt_count: attemptCount,
    exitCode,
    lockStatus,
    outcome: classification.outcome,
    failureSignals: classification.failure_signals,
    errorReason,
    parsedJson,
    lockSource,
    ...(providerUsage !== undefined ? { providerUsage } : {}),
    ...(input.codexMode !== undefined ? { codexMode: input.codexMode } : {}),
    ...(openRouterConfig !== null ? { openrouterMode: openRouterConfig.openrouterMode } : {}),
    ...(input.routingMode !== undefined ? { routingMode: input.routingMode } : {}),
    ...(taskPacketRef !== undefined ? { taskPacketRef } : {}),
    ...(input.generationSettings !== undefined ? { generationSettings: input.generationSettings } : {}),
    governanceSettings,
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

function sweepVendorArtifactsBestEffort(): void {
  try {
    sweepStaleVendorArtifactDirectories();
  } catch {
    // raw prompt/output TTL cleanup must never block vendor execution
  }
}

function sweepVendorProcessRegistryBestEffort(stateDir: string): void {
  try {
    const registryPath = stateFilePath(stateDir, VENDOR_PROCESS_REGISTRY_PATH);
    if (!existsSync(registryPath)) {
      return;
    }

    const records = parseVendorProcessRegistryLines(readFileSync(registryPath, "utf8"));
    const orphanedPids = selectOrphanedVendorPids({
      records,
      nowMs: Date.now(),
      maxAgeMs: DEFAULT_VENDOR_PROCESS_MAX_AGE_MS,
      isPidAlive: isPidAliveBestEffort
    });

    for (const pid of orphanedPids) {
      if (killVendorProcess(pid)) {
        appendBestEffort(registryPath, buildVendorProcessRecord({
          recordedAt: new Date().toISOString(),
          event: "exited",
          pid,
          workerRunId: openWorkerRunIdForPid(records, pid)
        }));
      }
    }
  } catch {
    // vendor process cleanup is best-effort and must never block vendor execution
  }
}

function isPidAliveBestEffort(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function openWorkerRunIdForPid(records: readonly VendorProcessRecord[], pid: number): string | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }

    if (record.pid !== pid || record.event !== "spawned") {
      continue;
    }

    if (!hasLaterVendorProcessExit(records, index, record)) {
      return record.worker_run_id;
    }
  }

  return null;
}

function hasLaterVendorProcessExit(
  records: readonly VendorProcessRecord[],
  spawnedIndex: number,
  spawned: VendorProcessRecord
): boolean {
  for (let index = spawnedIndex + 1; index < records.length; index += 1) {
    const candidate = records[index];
    if (candidate === undefined) {
      continue;
    }

    if (
      candidate.event === "exited" &&
      candidate.pid === spawned.pid &&
      candidate.worker_run_id === spawned.worker_run_id
    ) {
      return true;
    }
  }

  return false;
}

function appendBestEffort(path: string, record: unknown): void {
  try {
    appendStateFile(dirname(path), path, `${JSON.stringify(record)}\n`);
  } catch {
    // registry writes are best-effort and must never affect vendor execution
  }
}

/** Complete adapter route guard. Keep this as the first statement in runCliWorker. */
function assertCliWorkerRoute(input: CliWorkerInput): void {
  if (
    input.model !== undefined &&
    (input.model.length === 0 || /\s|[\x00-\x1f\x7f-\x9f]/.test(input.model) || input.model.startsWith("-"))
  ) {
    throw new Error("invalid_model");
  }
  const effort = input.generationSettings?.reasoning_effort;
  const supported: readonly RunReasoningEffort[] = SUPPORTED_REASONING_EFFORTS[input.vendor];
  if (effort !== undefined && !supported.includes(effort as RunReasoningEffort)) {
    throw new Error("unsupported_reasoning_effort");
  }
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

  return sanitizeWorkerError(vendor === "openrouter_api" ? redactOpenRouterApiKey(raw) : raw) ?? "worker_capture_failed";
}

function sanitizeParsedWorkerJson(value: unknown): unknown | null {
  if (value === null) return null;
  try {
    return parseSanitizedWorkerJson(JSON.stringify(value));
  } catch {
    return null;
  }
}

function unlinkBestEffort(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Governed ingestion must not fail because a temporary capture is already gone.
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }

  return String(err);
}

function appendRegistryEntry(entry: Record<string, unknown>, stateDir: string): void {
  const path = join(stateDir, "agent-registry.jsonl");
  appendStateFile(stateDir, path, `${JSON.stringify(entry)}\n`);
}

function writeResponseFile(content: string, runId: string, stateDir: string): string {
  const path = join(stateDir, `${runId}-output.txt`);
  writeStateFileAtomically(stateDir, path, content);
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

function providerForCliVendor(vendor: CliVendor): "openai_gpt" | "anthropic_claude" | "gemini_cli" | "openrouter" {
  switch (vendor) {
    case "codex_cli":
      return "openai_gpt";
    case "claude_cli":
      return "anthropic_claude";
    case "agy_cli":
      return "gemini_cli";
    case "openrouter_api":
      return "openrouter";
  }
}

function governanceSettingsFor(
  vendor: CliVendor,
  codexMode: CodexDispatchMode | undefined
): ModelGovernanceSettings {
  switch (vendor) {
    case "codex_cli": {
      const config = resolveCodexDispatchConfig(codexMode);
      return {
        sandbox: config.sandboxMode,
        approval_policy: config.approvalPolicy,
        ...(config.webSearch !== undefined ? { web_search: config.webSearch } : {})
      };
    }
    case "claude_cli":
      return { sandbox: "claude_plan", approval_policy: "never", web_search: false };
    case "agy_cli":
      return { sandbox: "agy_sandbox" };
    case "openrouter_api":
      return {
        allow_fallbacks: false,
        max_price: { prompt: 0, completion: 0, request: 0 }
      };
  }
}

function safeTelemetryTokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

function writeCliCallTelemetryRecord(record: CliCallTelemetryRecord, stateDir: string): void {
  appendStateFile(stateDir, stateFilePath(stateDir, CLI_CALL_TELEMETRY_PATH), `${JSON.stringify(record)}\n`);
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
