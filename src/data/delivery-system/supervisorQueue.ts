import { mkdirSync, readFileSync, renameSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { GovernedHandoff, DispatchResult } from "../../governed-core/dispatch";

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
      max_attempts: Math.min(MAX_ATTEMPTS, Math.max(1, input.maxAttempts ?? 3)),
      timeout_ms: Math.max(1_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      queued_at: now,
      updated_at: now,
      next_attempt_at: now,
      run_started_at: null,
      blocked_reason: input.requiresApproval === true && input.approvalGranted !== true ? "approval_required" : null,
      last_error: null,
      dependency_ids: [...new Set(input.dependencyIds ?? [])].slice(0, 32),
      requires_approval: input.requiresApproval === true,
      approval_granted: input.approvalGranted === true
    };
    this.state = { ...this.state, tasks: [...this.state.tasks, task] };
    this.persist();
    return task;
  }

  approve(taskId: string, now = new Date().toISOString()): SupervisorTask {
    const task = this.require(taskId);
    if (task.status !== "blocked" || !task.requires_approval) throw new Error("task_not_approval_blocked");
    return this.replace({ ...task, status: "queued", approval_granted: true, blocked_reason: null, updated_at: now, next_attempt_at: now });
  }

  claim(now = new Date().toISOString()): SupervisorTask | null {
    const candidate = this.peekClaimable(now);
    if (!candidate) return null;
    return this.replace({ ...candidate, status: "running", attempt: candidate.attempt + 1, run_started_at: now, updated_at: now, last_error: null });
  }

  peekClaimable(now = new Date().toISOString()): SupervisorTask | null {
    this.reconcile(now);
    const at = Date.parse(now);
    return this.state.tasks.find((task) => task.status === "queued" && Date.parse(task.next_attempt_at) <= at && this.dependenciesComplete(task)) ?? null;
  }

  complete(taskId: string, now = new Date().toISOString()): SupervisorTask {
    return this.transition(taskId, "completed", now, { run_started_at: null, blocked_reason: null });
  }

  fail(taskId: string, reason: string, now = new Date().toISOString()): SupervisorTask {
    const task = this.require(taskId);
    if (task.status !== "running") throw new Error("task_not_running");
    if (task.attempt < task.max_attempts) return this.retry(taskId, reason, now);
    return this.transition(taskId, "failed", now, { run_started_at: null, last_error: bounded(reason) });
  }

  retry(taskId: string, reason = "retry_requested", now = new Date().toISOString()): SupervisorTask {
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
    const changed = this.state.tasks.map((task) => task.status === "running" ? this.recoveredTask(task, now) : task);
    this.state = { ...this.state, tasks: changed };
    this.persist();
    return this.state.tasks;
  }

  reconcile(now = new Date().toISOString()): void {
    const at = Date.parse(now);
    const changed = this.state.tasks.map((task) => {
      if (task.status !== "running" || task.run_started_at === null || Date.parse(task.run_started_at) + task.timeout_ms > at) return task;
      return task.attempt >= task.max_attempts
        ? { ...task, status: "failed" as const, run_started_at: null, updated_at: now, last_error: "timeout" }
        : this.requeue(task, "timeout", now);
    });
    if (changed.some((task, index) => task !== this.state.tasks[index])) { this.state = { ...this.state, tasks: changed }; this.persist(); }
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
    const task = this.require(taskId);
    return this.replace({ ...task, ...extra, status, updated_at: now });
  }

  private replace(task: SupervisorTask): SupervisorTask {
    this.state = { ...this.state, tasks: this.state.tasks.map((candidate) => candidate.task_id === task.task_id ? task : candidate) };
    this.persist();
    return task;
  }

  private require(taskId: string): SupervisorTask { const task = this.state.tasks.find((candidate) => candidate.task_id === taskId); if (!task) throw new Error("task_not_found"); return task; }

  private load(): SupervisorState {
    try {
      if (!existsSync(this.path)) return { schema_version: "v1", tasks: [] };
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as SupervisorState;
      if (parsed.schema_version !== "v1" || !Array.isArray(parsed.tasks) || parsed.tasks.length > this.maxTasks) throw new Error("invalid_supervisor_state");
      return { schema_version: "v1", tasks: parsed.tasks };
    } catch (error) { if (error instanceof SyntaxError) throw new Error("invalid_supervisor_state"); throw error; }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state)}\n`, "utf8");
    renameSync(temporary, this.path);
  }
}

function bounded(value: string): string { return value.slice(0, 512); }
