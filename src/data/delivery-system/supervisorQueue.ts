import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { GovernedHandoff, DispatchResult } from "../../governed-core/dispatch";
import { readManagedStateTextFile } from "./managedStateFile";

export type SupervisorTaskStatus = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export interface GovernedHandoffReference {
  readonly handoff_id: string;
  readonly packet_hash: string;
  readonly task_packet_ref: string | null;
}

export interface SupervisorTask {
  readonly schema_version: "v1";
  readonly task_id: string;
  readonly session_id: string | null;
  readonly handoff: GovernedHandoff;
  readonly handoff_ref: GovernedHandoffReference;
  readonly status: SupervisorTaskStatus;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly timeout_ms: number;
  readonly queued_at: string;
  readonly updated_at: string;
  readonly next_attempt_at: string;
  readonly run_started_at: string | null;
  readonly blocked_reason: string | null;
  readonly last_error: string | null;
  readonly dependency_ids: readonly string[];
  readonly requires_approval: boolean;
  readonly approval_granted: boolean;
}

interface SupervisorState {
  readonly schema_version: "v1";
  readonly tasks: readonly SupervisorTask[];
}

export interface SupervisorQueueOptions {
  readonly stateDir: string;
  readonly fileName?: string;
  readonly maxTasks?: number;
  readonly maxPromptChars?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
}

export interface EnqueueSupervisorTaskInput {
  readonly taskId: string;
  readonly handoff: GovernedHandoff;
  readonly sessionId?: string | null;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly dependencyIds?: readonly string[];
  readonly requiresApproval?: boolean;
  readonly approvalGranted?: boolean;
  readonly now?: string;
}

const DEFAULT_FILE_NAME = "supervisor-queue.json";
const DEFAULT_MAX_TASKS = 256;
const DEFAULT_MAX_PROMPT_CHARS = 32_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
const MAX_DEPENDENCIES = 32;
const MAX_ERROR_CHARS = 512;
const MAX_SUPERVISOR_STATE_BYTES = 4 * 1024 * 1024;

export function validateSupervisorState(
  stateDir: string,
  options: Pick<SupervisorQueueOptions, "fileName" | "maxTasks" | "maxPromptChars"> = {}
): void {
  readSupervisorState(
    join(stateDir, options.fileName ?? DEFAULT_FILE_NAME),
    options.maxTasks ?? DEFAULT_MAX_TASKS,
    options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS
  );
}

/** Durable, bounded lifecycle state for governed handoffs. Dispatch remains in governed-core. */
export class SupervisorQueue {
  private readonly path: string;
  private readonly maxTasks: number;
  private readonly maxPromptChars: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private state: SupervisorState;

  constructor(options: SupervisorQueueOptions) {
    this.path = join(options.stateDir, options.fileName ?? DEFAULT_FILE_NAME);
    this.maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
    this.maxPromptChars = options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 1_000;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 5 * 60_000;
    this.state = this.load();
  }

  snapshot(): readonly SupervisorTask[] { return this.state.tasks; }

  enqueue(input: EnqueueSupervisorTaskInput): SupervisorTask {
    if (!input.taskId.trim()) throw new Error("invalid_task_id");
    if (input.handoff.prompt.length > this.maxPromptChars) throw new Error("supervisor_prompt_too_large");
    if (this.state.tasks.some((task) => task.task_id === input.taskId)) throw new Error("task_already_exists");
    if (this.state.tasks.length >= this.maxTasks) throw new Error("supervisor_queue_full");
    const now = input.now ?? new Date().toISOString();
    assertSupervisorTimestamp(now);
    const maxAttempts = boundedIntegerInput(input.maxAttempts, 3, 1, MAX_ATTEMPTS);
    const timeoutMs = boundedIntegerInput(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, Number.MAX_SAFE_INTEGER);
    const dependencyIds = [...new Set(input.dependencyIds ?? [])].slice(0, MAX_DEPENDENCIES);
    const dependencyGraph = [...this.state.tasks, { task_id: input.taskId, dependency_ids: dependencyIds }];
    if (dependencyIds.some((id) => !id.trim() || id === input.taskId) || hasDependencyCycle(dependencyGraph)) {
      throw new Error("invalid_task_dependency");
    }
    const handoffRef: GovernedHandoffReference = {
      handoff_id: String(input.handoff.handoffId),
      packet_hash: input.handoff.packet_hash,
      task_packet_ref: input.handoff.taskPacketRef ?? null
    };
    const task: SupervisorTask = {
      schema_version: "v1",
      task_id: input.taskId,
      session_id: input.sessionId ?? input.handoff.sessionId ?? null,
      handoff: input.handoff,
      handoff_ref: handoffRef,
      status: input.requiresApproval === true && input.approvalGranted !== true ? "blocked" : "queued",
      attempt: 0,
      max_attempts: maxAttempts,
      timeout_ms: timeoutMs,
      queued_at: now,
      updated_at: now,
      next_attempt_at: now,
      run_started_at: null,
      blocked_reason: input.requiresApproval === true && input.approvalGranted !== true ? "approval_required" : null,
      last_error: null,
      dependency_ids: dependencyIds,
      requires_approval: input.requiresApproval === true,
      approval_granted: input.approvalGranted === true
    };
    this.publish({ ...this.state, tasks: [...this.state.tasks, task] });
    return this.require(input.taskId);
  }

  approve(taskId: string, now = new Date().toISOString()): SupervisorTask {
    assertSupervisorTimestamp(now);
    const task = this.require(taskId);
    if (task.status !== "blocked" || !task.requires_approval) throw new Error("task_not_approval_blocked");
    return this.replace({ ...task, status: "queued", approval_granted: true, blocked_reason: null, updated_at: now, next_attempt_at: now });
  }

  claim(now = new Date().toISOString()): SupervisorTask | null {
    assertSupervisorTimestamp(now);
    const candidate = this.peekClaimable(now);
    if (!candidate) return null;
    return this.replace({ ...candidate, status: "running", attempt: candidate.attempt + 1, run_started_at: now, updated_at: now, last_error: null });
  }

  peekClaimable(now = new Date().toISOString()): SupervisorTask | null {
    assertSupervisorTimestamp(now);
    this.reconcile(now);
    const at = Date.parse(now);
    return this.state.tasks.find((task) => task.status === "queued" && Date.parse(task.next_attempt_at) <= at && this.dependenciesComplete(task)) ?? null;
  }

  complete(taskId: string, now = new Date().toISOString()): SupervisorTask {
    return this.transition(taskId, "completed", now, { run_started_at: null, blocked_reason: null });
  }

  fail(taskId: string, reason: string, now = new Date().toISOString()): SupervisorTask {
    assertSupervisorTimestamp(now);
    const task = this.require(taskId);
    if (task.status !== "running") throw new Error("task_not_running");
    if (task.attempt < task.max_attempts) return this.retry(taskId, reason, now);
    return this.transition(taskId, "failed", now, { run_started_at: null, last_error: bounded(reason) });
  }

  retry(taskId: string, reason = "retry_requested", now = new Date().toISOString()): SupervisorTask {
    assertSupervisorTimestamp(now);
    const task = this.require(taskId);
    if (task.status !== "running" && task.status !== "failed") throw new Error("task_not_retryable");
    if (task.attempt >= task.max_attempts) return this.transition(taskId, "failed", now, { run_started_at: null, last_error: bounded(reason) });
    const delay = Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * 2 ** Math.max(0, task.attempt - 1));
    const next = new Date(Date.parse(now) + delay).toISOString();
    return this.replace({ ...task, status: "queued", run_started_at: null, updated_at: now, next_attempt_at: next, last_error: bounded(reason) });
  }

  cancel(taskId: string, reason = "cancelled", now = new Date().toISOString()): SupervisorTask {
    const task = this.require(taskId);
    if (["completed", "failed", "cancelled"].includes(task.status)) throw new Error("task_already_terminal");
    return this.transition(taskId, "cancelled", now, { run_started_at: null, last_error: bounded(reason), blocked_reason: null });
  }

  /** Requeues in-flight work after a process restart and transitions expired runs to retry/failed. */
  recover(now = new Date().toISOString()): readonly SupervisorTask[] {
    assertSupervisorTimestamp(now);
    const changed = this.state.tasks.map((task) => task.status === "running" ? this.recoveredTask(task, now) : task);
    this.publish({ ...this.state, tasks: changed });
    return this.state.tasks;
  }

  reconcile(now = new Date().toISOString()): void {
    assertSupervisorTimestamp(now);
    const at = Date.parse(now);
    const changed = this.state.tasks.map((task) => {
      if (task.status !== "running" || task.run_started_at === null || Date.parse(task.run_started_at) + task.timeout_ms > at) return task;
      return task.attempt >= task.max_attempts
        ? { ...task, status: "failed" as const, run_started_at: null, updated_at: now, last_error: "timeout" }
        : this.requeue(task, "timeout", now);
    });
    if (changed.some((task, index) => task !== this.state.tasks[index])) this.publish({ ...this.state, tasks: changed });
  }

  async dispatchClaimed(taskId: string, stateDir: string, dispatch: (handoff: GovernedHandoff, stateDir: string) => Promise<DispatchResult>): Promise<DispatchResult> {
    const task = this.require(taskId);
    if (task.status !== "running") throw new Error("task_not_running");
    try {
      const result = await dispatch(task.handoff, stateDir);
      if (result.refused) this.fail(taskId, result.reason);
      else this.complete(taskId);
      return result;
    } catch (error) {
      this.fail(taskId, error instanceof Error ? error.message : "dispatch_failed");
      throw error;
    }
  }

  /** Claims at most one ready handoff and sends it through the existing governed dispatcher. */
  async runOnce(stateDir: string, dispatch: (handoff: GovernedHandoff, stateDir: string) => Promise<DispatchResult>, now = new Date().toISOString()): Promise<{ readonly task: SupervisorTask; readonly result: DispatchResult } | null> {
    const task = this.claim(now);
    if (task === null) return null;
    const result = await this.dispatchClaimed(task.task_id, stateDir, dispatch);
    return { task: this.require(task.task_id), result };
  }

  private recoveredTask(task: SupervisorTask, now: string): SupervisorTask {
    if (task.attempt >= task.max_attempts) return { ...task, status: "failed", run_started_at: null, updated_at: now, last_error: "recovered_attempt_limit" };
    return this.requeue(task, "recovered_after_restart", now);
  }

  private requeue(task: SupervisorTask, reason: string, now: string): SupervisorTask {
    const delay = Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * 2 ** Math.max(0, task.attempt - 1));
    return { ...task, status: "queued", run_started_at: null, updated_at: now, next_attempt_at: new Date(Date.parse(now) + delay).toISOString(), last_error: reason };
  }

  private dependenciesComplete(task: SupervisorTask): boolean {
    return task.dependency_ids.every((id) => this.state.tasks.find((candidate) => candidate.task_id === id)?.status === "completed");
  }

  private transition(taskId: string, status: SupervisorTaskStatus, now: string, extra: Partial<SupervisorTask>): SupervisorTask {
    assertSupervisorTimestamp(now);
    const task = this.require(taskId);
    return this.replace({ ...task, ...extra, status, updated_at: now });
  }

  private replace(task: SupervisorTask): SupervisorTask {
    this.publish({ ...this.state, tasks: this.state.tasks.map((candidate) => candidate.task_id === task.task_id ? task : candidate) });
    return this.require(task.task_id);
  }

  private require(taskId: string): SupervisorTask { const task = this.state.tasks.find((candidate) => candidate.task_id === taskId); if (!task) throw new Error("task_not_found"); return task; }

  private load(): SupervisorState {
    return readSupervisorState(this.path, this.maxTasks, this.maxPromptChars);
  }

  private publish(next: SupervisorState): void {
    let serialized: string;
    try {
      serialized = `${JSON.stringify(next)}\n`;
    } catch {
      throw new Error("invalid_supervisor_state");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_SUPERVISOR_STATE_BYTES) {
      throw new Error("supervisor_state_too_large");
    }
    const persisted: unknown = JSON.parse(serialized);
    if (!isSupervisorState(persisted, this.maxTasks, this.maxPromptChars)) throw new Error("invalid_supervisor_state");
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, serialized, "utf8");
    renameSync(temporary, this.path);
    this.state = persisted;
  }
}

function bounded(value: string): string { return value.slice(0, MAX_ERROR_CHARS); }

function readSupervisorState(path: string, maxTasks: number, maxPromptChars: number): SupervisorState {
  try {
    const file = readManagedStateTextFile(path, { maxBytes: MAX_SUPERVISOR_STATE_BYTES });
    if (file.status === "missing") return { schema_version: "v1", tasks: [] };
    const parsed: unknown = JSON.parse(file.text);
    if (!isSupervisorState(parsed, maxTasks, maxPromptChars)) throw new Error("invalid_supervisor_state");
    return parsed;
  } catch {
    throw new Error("invalid_supervisor_state");
  }
}

function isSupervisorState(value: unknown, maxTasks: number, maxPromptChars: number): value is SupervisorState {
  if (!isRecord(value) || value.schema_version !== "v1" || !Array.isArray(value.tasks) || value.tasks.length > maxTasks) {
    return false;
  }
  const taskIds = new Set<string>();
  for (const task of value.tasks) {
    if (!isRecord(task) || task.schema_version !== "v1" || !isRecord(task.handoff) || !isRecord(task.handoff_ref)) {
      return false;
    }
    if (typeof task.task_id !== "string" || !task.task_id.trim() || taskIds.has(task.task_id)) return false;
    taskIds.add(task.task_id);
    if (!(isGovernedHandoff(task.handoff, maxPromptChars) &&
      (task.session_id === null || typeof task.session_id === "string") &&
      typeof task.handoff_ref.handoff_id === "string" &&
      typeof task.handoff_ref.packet_hash === "string" &&
      (task.handoff_ref.task_packet_ref === null || typeof task.handoff_ref.task_packet_ref === "string") &&
      ["queued", "running", "blocked", "completed", "failed", "cancelled"].includes(String(task.status)) &&
      isNonNegativeInteger(task.attempt) && isPositiveInteger(task.max_attempts) && task.max_attempts <= MAX_ATTEMPTS && task.attempt <= task.max_attempts &&
      (task.status !== "queued" || task.attempt < task.max_attempts) &&
      isPositiveInteger(task.timeout_ms) && task.timeout_ms >= 1_000 &&
      [task.queued_at, task.updated_at, task.next_attempt_at].every(isValidTimestamp) &&
      (task.run_started_at === null || isValidTimestamp(task.run_started_at)) &&
      (task.blocked_reason === null || typeof task.blocked_reason === "string") &&
      (task.last_error === null || typeof task.last_error === "string" && task.last_error.length <= MAX_ERROR_CHARS) &&
      isUniqueNonEmptyStringArray(task.dependency_ids, MAX_DEPENDENCIES) &&
      typeof task.requires_approval === "boolean" && typeof task.approval_granted === "boolean" &&
      task.handoff_ref.handoff_id === task.handoff.handoffId &&
      task.handoff_ref.packet_hash === task.handoff.packet_hash &&
      task.handoff_ref.task_packet_ref === (task.handoff.taskPacketRef ?? null) &&
      (task.status === "running" ? task.run_started_at !== null && task.attempt > 0 : task.run_started_at === null) &&
      (task.status !== "blocked" || task.requires_approval && !task.approval_granted && task.blocked_reason === "approval_required"))) {
      return false;
    }
  }

  for (const task of value.tasks) {
    if (!isRecord(task) || !Array.isArray(task.dependency_ids)) return false;
    if (task.dependency_ids.some((id) => id === task.task_id)) return false;
  }
  return !hasDependencyCycle(value.tasks);
}

function isGovernedHandoff(value: Record<string, unknown>, maxPromptChars: number): boolean {
  return typeof value.handoffId === "string" &&
    ["codex_cli", "claude_cli", "agy_cli", "openrouter_api"].includes(String(value.vendor)) &&
    typeof value.prompt === "string" && value.prompt.length <= maxPromptChars &&
    typeof value.parentSessionHash === "string" &&
    typeof value.parentTurnHash === "string" &&
    typeof value.task === "string" &&
    typeof value.agent === "string" &&
    typeof value.packet_hash === "string" &&
    isStringArray(value.required_checks) &&
    isOptionalString(value.sessionId) &&
    isOptionalStringArray(value.skillIds) &&
    isOptionalString(value.outputSchemaPath) &&
    isOptionalEnum(value.codexMode, ["codex_implement", "codex_review", "codex_research"]) &&
    isOptionalEnum(value.openrouterMode, ["qwen3_code_draft", "nemotron_planning"]) &&
    isOptionalEnum(value.routingMode, ["idea", "spec", "build", "review"]) &&
    isOptionalString(value.taskPacketRef) &&
    isOptionalString(value.model) &&
    isOptionalPositiveInteger(value.timeoutMs) &&
    isOptionalString(value.cwd) &&
    isOptionalStringArray(value.addDirs) &&
    isOptionalStringArray(value.images) &&
    isOptionalString(value.lockSource) &&
    isOptionalPositiveInteger(value.maxPromptChars) &&
    (value.maxPromptChars === undefined || value.prompt.length <= value.maxPromptChars) &&
    isOptionalGenerationSettings(value.generationSettings) &&
    isOptionalEnum(value.routing_mode, ["idea", "spec", "build", "review"]) &&
    isOptionalString(value.task_package_hash) &&
    isOptionalPrepProvenance(value.prep_provenance) &&
    isOptionalRoutingContext(value.routing);
}

function isOptionalGenerationSettings(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return ["temperature", "top_p", "top_k", "min_p", "max_output_tokens"].every((field) => isOptionalFiniteNumber(value[field])) &&
    isOptionalString(value.reasoning_effort) &&
    (value.speculative_decoding === undefined || isRecord(value.speculative_decoding) &&
      typeof value.speculative_decoding.type === "string" &&
      isOptionalFiniteNumber(value.speculative_decoding.draft_length));
}

function isOptionalPrepProvenance(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.kind === "cheap_attempts") return isUniqueNonEmptyStringArray(value.cheap_attempt_refs);
  return value.kind === "cheap_not_applicable" && typeof value.reason === "string" && value.reason.trim().length > 0 && value.owner_override === true;
}

function isOptionalRoutingContext(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return ["orchestrator", "architect", "reviewer", "tester", "micro_worker", "bounded_coding", "memory_summarizer", "copywriter"].includes(String(value.layer)) &&
    Array.isArray(value.budgets) && value.budgets.every(isSubscriptionBudget) &&
    Array.isArray(value.evalRecords) && value.evalRecords.every(isEvalRecord) &&
    (value.recentFailureSignals === undefined || Array.isArray(value.recentFailureSignals) && value.recentFailureSignals.every(isTierFailureSignal)) &&
    (value.circuitBreakerThresholds === undefined || isCircuitBreakerThresholds(value.circuitBreakerThresholds)) &&
    (value.now === undefined || isValidTimestamp(value.now));
}

function isSubscriptionBudget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isReasoningProvider(value.provider) &&
    isOptionalString(value.activeTierId) &&
    isRateLimitState(value.activeTierRateLimitState) &&
    isOptionalTimestamp(value.rateLimitHitAt) &&
    isOptionalTimestamp(value.lastAttemptedAt) &&
    Array.isArray(value.availableTiers) && value.availableTiers.every(isProviderTier) &&
    isStringArray(value.exhaustedTierIds) &&
    ["sessionTaskCount", "sessionInputTokens", "sessionOutputTokens", "sessionTotalTokens", "sessionCallCount"].every((field) => isNonNegativeInteger(value[field])) &&
    isOptionalTimestamp(value.lastSuccessfulTaskAt) &&
    isOptionalString(value.notes);
}

function isProviderTier(value: unknown): boolean {
  return isRecord(value) && isReasoningProvider(value.provider) &&
    typeof value.tierId === "string" && typeof value.label === "string" &&
    isOptionalString(value.cliAccessPath) && typeof value.verifiedLocally === "boolean" &&
    isRateLimitState(value.rateLimitState) && isFiniteNumber(value.costWeight) &&
    isOptionalString(value.notes) && isOptionalTimestamp(value.lastAttemptedAt);
}

function isEvalRecord(value: unknown): boolean {
  return isRecord(value) && typeof value.taskType === "string" &&
    ["openai", "anthropic", "google", "qwen", "deepseek", "local", "unknown"].includes(String(value.provider)) &&
    ["needs_scoring", "accepted", "retry_with_prompt_or_input_tuning", "review_model_or_reasoning_route", "blocked"].includes(String(value.state)) &&
    isFiniteNumber(value.scoreAverage) && isStringArray(value.failureLabels) && isNonNegativeInteger(value.rerunCount);
}

function isTierFailureSignal(value: unknown): boolean {
  return isRecord(value) && isReasoningProvider(value.provider) && isOptionalString(value.tierId) &&
    ["timeout", "auth_error", "empty_output", "invalid_json", "non_zero_exit"].includes(String(value.failureSignal)) &&
    isValidTimestamp(value.recordedAt);
}

function isCircuitBreakerThresholds(value: unknown): boolean {
  return isRecord(value) && isPositiveInteger(value.failureThreshold) && isPositiveInteger(value.windowMs) &&
    isPositiveInteger(value.cooldownMs) &&
    (value.failureSignals === undefined || Array.isArray(value.failureSignals) && value.failureSignals.every((signal) =>
      ["timeout", "auth_error", "empty_output", "invalid_json", "non_zero_exit"].includes(String(signal))));
}

function isReasoningProvider(value: unknown): boolean {
  return ["deterministic_tools", "qwen_local", "openai_gpt", "anthropic_claude_subscription", "gemini_cli", "deepseek_api_or_self_hosted", "openrouter_free", "deepseek_web_chat_manual"].includes(String(value));
}

function isRateLimitState(value: unknown): boolean {
  return ["available", "rate_limited", "exhausted", "unknown"].includes(String(value));
}

function hasDependencyCycle(tasks: readonly unknown[]): boolean {
  const dependencies = new Map<string, readonly string[]>();
  for (const task of tasks) {
    if (!isRecord(task) || typeof task.task_id !== "string" || !isStringArray(task.dependency_ids)) return true;
    dependencies.set(task.task_id, task.dependency_ids);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (taskId: string): boolean => {
    if (active.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    active.add(taskId);
    if ((dependencies.get(taskId) ?? []).some(visit)) return true;
    active.delete(taskId);
    visited.add(taskId);
    return false;
  };
  return [...dependencies.keys()].some(visit);
}

function assertSupervisorTimestamp(value: string): void {
  if (!isValidTimestamp(value)) throw new Error("invalid_supervisor_timestamp");
}

function boundedIntegerInput(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value)) throw new Error("invalid_supervisor_numeric_input");
  return Math.min(maximum, Math.max(minimum, value));
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || isValidTimestamp(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isUniqueNonEmptyStringArray(value: unknown, maxItems = Number.MAX_SAFE_INTEGER): value is readonly string[] {
  return isStringArray(value) && value.length <= maxItems &&
    value.every((item) => item.trim().length > 0) && new Set(value).size === value.length;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

function isOptionalEnum(value: unknown, allowed: readonly string[]): boolean {
  return value === undefined || typeof value === "string" && allowed.includes(value);
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || isPositiveInteger(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
