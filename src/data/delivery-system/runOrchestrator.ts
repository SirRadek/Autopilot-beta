import { randomUUID } from "node:crypto";

import { createApprovalRecord, decideApproval, readApprovalQueue, writeApprovalQueue } from "./approvalQueue";
import { isRunRouteEligible } from "./runRouteEligibility";
import { resolveEnabledProject } from "./projectRegistry";
import { appendRunArtifact, approveRunRevision, bindRunToSupervisor, clearRunDispatchFailure, clearRunProviderResultForRetry, clearRunSupervisorBinding, createRunDraft, finalizeRun, markRunReservationTerminal, readRunStore, recordRunDispatchFailure, recordRunProviderResult, requestRunCancellation, requestRunQueueCompensation, transitionRun, type RunDraftInput, type RunRecord, type RunReservation } from "./runStore";
import type { TokenReservation, TokenReservationRequest, TokenSettlement } from "./tokenGateway";
import { redactTelemetryText } from "./telemetryRedaction";
import { assertRunPromptPolicy, canonicalRunTokenBudget, conservativeRunPromptTokens } from "./runPromptPolicy";
import type { GovernedHandoff, DispatchResult } from "../../governed-core/dispatch";
import { computePacketHash } from "../../governed-core/dispatch";
import { buildAgentPacket, loadDecisionMeshFromRoot } from "../../lib/decision-mesh";

interface Gateway {
  reserve(input: TokenReservationRequest): TokenReservation;
  release(reservation: TokenReservation): void;
  settle(reservation: TokenReservation, usage: TokenSettlement): TokenSettlement | void;
  findActiveReservation?(handoffId: string): TokenReservation | null;
  acknowledgeTerminal?(reservationId: string): void;
}

interface SupervisorTaskView {
  readonly task_id?: string;
  readonly taskId?: string;
  readonly status?: string;
  readonly handoff: GovernedHandoff;
}

interface Supervisor {
  enqueue(input: { readonly taskId: string; readonly handoff: GovernedHandoff; readonly sessionId: string; readonly requiresApproval: true; readonly approvalGranted: true; readonly now: string; readonly maxAttempts?: number }): unknown;
  claim(now: string): SupervisorTaskView | null;
  complete(taskId: string, now?: string): unknown;
  fail(taskId: string, reason: string, now?: string): { readonly status?: string };
  cancel(taskId: string, reason?: string, now?: string): unknown;
  snapshot?(): readonly SupervisorTaskView[];
}

export interface QueuedRun extends RunRecord { readonly supervisor_task_id: string; }

export function createRunOrchestrator(options: {
  readonly stateDir: string;
  readonly tokenGateway: Gateway;
  readonly supervisor: Supervisor;
  readonly dispatch: (handoff: GovernedHandoff, stateDir: string) => Promise<DispatchResult>;
  readonly now?: () => string;
  readonly isRouteAvailable?: (provider: string, model: string | null) => boolean;
  readonly afterPhase?: (phase: "bound" | "queued" | "reservation_terminal" | "artifact" | "finalized" | "compensation_cleared") => void;
  readonly supervisorMaxAttempts?: number;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  function record(runId: string): RunRecord {
    const value = readRunStore(options.stateDir).runs.find((run) => run.current.run_id === runId);
    if (value === undefined) throw new Error("run_not_found");
    return value;
  }

  function routeAvailable(provider: string, model: string | null): boolean {
    if (options.isRouteAvailable !== undefined) return options.isRouteAvailable(provider, model);
    return isRunRouteEligible(options.stateDir, provider, model, now());
  }

  function prepareRun(input: RunDraftInput): RunRecord {
    resolveEnabledProject(options.stateDir, input.project_id);
    if (!routeAvailable(input.provider, input.model)) throw new Error("run_route_unavailable");
    const draft = createRunDraft(options.stateDir, input, now());
    const approval = createApprovalRecord({ approvalId: `run-approval-${draft.run_id}-${draft.revision}`, runId: draft.run_id, revision: draft.revision, sessionId: draft.run_id, vendor: draft.provider, ...(draft.model === null ? {} : { model: draft.model }), skillIds: [], prompt: draft.prompt, estimatedTokens: draft.estimated_tokens, promptReviewAcknowledged: draft.prompt_review_acknowledged, now: now() });
    const queue = readApprovalQueue(options.stateDir);
    writeApprovalQueue(options.stateDir, { ...queue, records: [...queue.records, approval] });
    return record(draft.run_id);
  }

  function handoffFor(run: RunRecord): GovernedHandoff {
    assertRunPromptPolicy(run.current.prompt, run.current.prompt_review_acknowledged);
    if (run.current.estimated_tokens !== canonicalRunTokenBudget(run.current.prompt)) throw new Error("run_token_budget_mismatch");
    const task = `Execute approved run ${run.current.run_id} revision ${run.current.revision}`;
    const agent = "worker";
    const packet = buildAgentPacket(loadDecisionMeshFromRoot(process.cwd()), { task, agent, token_budget: run.current.estimated_tokens });
    return {
      handoffId: `run-handoff-${run.current.run_id}-${run.current.revision}` as GovernedHandoff["handoffId"],
      sessionId: run.current.run_id,
      vendor: run.current.provider,
      ...(run.current.model === null ? {} : { model: run.current.model }),
      prompt: run.current.prompt,
      cwd: resolveEnabledProject(options.stateDir, run.current.project_id).cwd,
      parentSessionHash: run.current.run_id,
      parentTurnHash: String(run.current.revision),
      task,
      agent,
      packet_hash: computePacketHash(packet),
      required_checks: packet.required_checks
    };
  }

  function reconcileQueueCompensation(run: RunRecord): RunRecord {
    if (!run.queue_compensation_requested || run.supervisor_task_id === null || run.token_reservation === null) return run;
    let firstError: unknown;
    const task = options.supervisor.snapshot?.().find((candidate) => candidate.task_id === run.supervisor_task_id);
    const taskNeedsCancellation = options.supervisor.snapshot === undefined || (task !== undefined && !["cancelled", "failed", "completed"].includes(task.status ?? ""));
    if (taskNeedsCancellation) {
      try { options.supervisor.cancel(run.supervisor_task_id, "enqueue_failed", now()); } catch (error) { firstError = error; }
    }
    if (run.reservation_status === "active") {
      try {
        options.tokenGateway.release(run.token_reservation);
        run = markRunReservationTerminal(options.stateDir, run.current.run_id, "released", now());
      } catch (error) { firstError ??= error; }
    }
    const latestTask = options.supervisor.snapshot?.().find((candidate) => candidate.task_id === run.supervisor_task_id);
    if (firstError === undefined && (latestTask === undefined || ["cancelled", "failed", "completed"].includes(latestTask.status ?? "")) && run.reservation_status === "released") {
      const cleared = clearRunSupervisorBinding(options.stateDir, run.current.run_id, now());
      options.afterPhase?.("compensation_cleared");
      return cleared;
    }
    if (firstError !== undefined) throw firstError;
    return run;
  }

  function approveAndQueueRun(runId: string, revision: number, operator: string): QueuedRun {
    const before = record(runId);
    if (before.current.revision !== revision) throw new Error("run_revision_conflict");
    if (before.status === "queued" && before.supervisor_task_id !== null) return { ...before, supervisor_task_id: before.supervisor_task_id };
    if (!["draft", "approved"].includes(before.status)) throw new Error("run_revision_conflict");
    if (!routeAvailable(before.current.provider, before.current.model)) throw new Error("run_route_unavailable");
    const queue = readApprovalQueue(options.stateDir);
    const index = queue.records.findIndex((item) => item.run_id === runId && item.revision === revision);
    if (index < 0) throw new Error("approval_not_found");
    const approval = queue.records[index]!;
    if (approval.prompt_review_acknowledged !== before.current.prompt_review_acknowledged || approval.estimated_tokens !== before.current.estimated_tokens) throw new Error("run_revision_conflict");
    if (approval.status === "pending") {
      const decided = decideApproval(approval, "approved", now());
      writeApprovalQueue(options.stateDir, { ...queue, records: queue.records.map((item, candidate) => candidate === index ? decided : item) });
    } else if (approval.status !== "approved") throw new Error("approval_not_approved");
    const approved = approveRunRevision(options.stateDir, runId, revision, operator, now());
    const handoff = handoffFor(approved);
    const inputTokens = conservativeRunPromptTokens(approved.current.prompt);
    let durable = record(runId);
    if (durable.queue_compensation_requested) durable = reconcileQueueCompensation(durable);
    if (durable.status === "approved" && durable.reservation_status === "released") {
      durable = clearRunSupervisorBinding(options.stateDir, runId, now());
    }
    let reservation = durable.token_reservation;
    let taskId = durable.supervisor_task_id;
    if (reservation === null || taskId === null) {
      reservation = options.tokenGateway.reserve({ provider: approved.current.provider, model: approved.current.model, sessionId: runId, inputTokens, outputTokens: approved.current.estimated_tokens - inputTokens, handoffId: handoff.handoffId as string });
      taskId = `run-task-${randomUUID()}`;
      bindRunToSupervisor(options.stateDir, runId, taskId, reservation as RunReservation, now());
      options.afterPhase?.("bound");
    }
    const existingTask = options.supervisor.snapshot?.().find((task) => task.task_id === taskId);
    if (existingTask === undefined) {
      try { options.supervisor.enqueue({ taskId, handoff, sessionId: runId, requiresApproval: true, approvalGranted: true, now: now(), ...(options.supervisorMaxAttempts === undefined ? {} : { maxAttempts: options.supervisorMaxAttempts }) }); }
      catch (error) {
        const compensating = requestRunQueueCompensation(options.stateDir, runId, now());
        try { reconcileQueueCompensation(compensating); } catch { /* durable compensation is replayed on retry */ }
        throw error;
      }
    }
    const queued = transitionRun(options.stateDir, runId, "queued", now());
    options.afterPhase?.("queued");
    return { ...queued, supervisor_task_id: taskId };
  }

  function bindingForTask(taskId: string): RunRecord {
    const run = readRunStore(options.stateDir).runs.find((item) => item.supervisor_task_id === taskId);
    if (run === undefined || run.token_reservation === null) throw new Error("run_binding_not_found");
    return run;
  }

  function taskForPendingResult(): SupervisorTaskView | null {
    const pending = readRunStore(options.stateDir).runs.find((run) => run.provider_result !== null && !["completed", "failed", "cancelled"].includes(run.status));
    if (pending?.supervisor_task_id === null || pending?.supervisor_task_id === undefined) return null;
    return options.supervisor.snapshot?.().find((task) => task.task_id === pending.supervisor_task_id) ?? null;
  }

  function persistResult(run: RunRecord, result: DispatchResult): RunRecord {
    return recordRunProviderResult(options.stateDir, run.current.run_id, result.refused
      ? { refused: true, reason: result.reason, worker_run_id: null, raw_output: "", exit_code: null, error_reason: null, lock_status: null }
      : { refused: false, reason: null, worker_run_id: result.workerRunId, raw_output: redactTelemetryText(result.rawOutput, 32_000), exit_code: result.exitCode ?? 0, error_reason: result.errorReason == null ? null : redactTelemetryText(result.errorReason, 32_000), lock_status: result.lockStatus ?? "acquired_supervisor_spawn" }, now());
  }

  function reconstructedResult(run: RunRecord): DispatchResult {
    const result = run.provider_result!;
    if (result.refused) return { refused: true, reason: result.reason as Extract<DispatchResult, { refused: true }>["reason"], tier_id: null, provenance_verified: true };
    return { refused: false, workerRunId: result.worker_run_id!, handoffId: "persisted" as Extract<DispatchResult, { refused: false }>["handoffId"], vendor: run.current.provider, model: run.current.model, exitCode: result.exit_code ?? 1, rawOutput: result.raw_output, parsedJson: null, durationSeconds: 0, lockStatus: result.lock_status ?? "failed", workerOutputPath: null, errorReason: result.error_reason, tier_id: null, provenance_verified: true };
  }

  function finishProviderResult(taskId: string, run: RunRecord, result: DispatchResult): (RunRecord & { readonly result: DispatchResult }) | null {
    const reservation = run.token_reservation!;
    if (result.refused) {
      if (run.reservation_status === "active") {
        options.tokenGateway.release(reservation);
        run = markRunReservationTerminal(options.stateDir, run.current.run_id, "released", now());
        options.afterPhase?.("reservation_terminal");
      }
      const task = options.supervisor.snapshot?.().find((item) => item.task_id === taskId);
      if (task?.status === undefined || !["cancelled", "failed", "completed"].includes(task.status)) options.supervisor.cancel(taskId, result.reason, now());
      const finalized = finalizeRun(options.stateDir, run.current.run_id, "failed", result.reason, now());
      options.afterPhase?.("finalized");
      options.tokenGateway.acknowledgeTerminal?.(reservation.reservationId);
      return { ...finalized, result };
    }
    const failed = (result.exitCode ?? 0) !== 0 || result.errorReason != null || result.lockStatus === "failed";
    const cancelled = record(run.current.run_id).cancellation_requested;
    const task = options.supervisor.snapshot?.().find((item) => item.task_id === taskId);
    const attemptInputTokens = conservativeRunPromptTokens(run.current.prompt);
    const attemptOutputTokens = conservativeRunPromptTokens(result.rawOutput);
    const cumulativeInputTokens = run.retry_input_tokens + attemptInputTokens;
    const cumulativeOutputTokens = run.retry_output_tokens + attemptOutputTokens;
    let retryQueued = false;
    if (cancelled) options.supervisor.cancel(taskId, "run_cancelled", now());
    else if (failed) {
      const outcome = options.supervisor.fail(taskId, result.errorReason ?? `worker_exit_${result.exitCode}`, now());
      retryQueued = outcome.status === "queued";
    }
    if (cumulativeInputTokens + cumulativeOutputTokens > run.current.estimated_tokens) {
      const latestTask = options.supervisor.snapshot?.().find((item) => item.task_id === taskId);
      if (!cancelled && (retryQueued || !failed) && (latestTask === undefined || !["completed", "failed", "cancelled"].includes(latestTask.status ?? ""))) options.supervisor.cancel(taskId, "token_settlement_exceeds_reservation", now());
      if (run.reservation_status === "active") {
        options.tokenGateway.release(reservation);
        run = markRunReservationTerminal(options.stateDir, run.current.run_id, "released", now());
        options.afterPhase?.("reservation_terminal");
      }
      const finalized = finalizeRun(options.stateDir, run.current.run_id, "failed", "token_settlement_exceeds_reservation", now());
      options.afterPhase?.("finalized");
      options.tokenGateway.acknowledgeTerminal?.(reservation.reservationId);
      return { ...finalized, result };
    }
    if (retryQueued) {
      clearRunProviderResultForRetry(options.stateDir, run.current.run_id, attemptInputTokens, attemptOutputTokens, now());
      return null;
    }
    if (!cancelled && !failed && (task === undefined || task.status === "running")) options.supervisor.complete(taskId, now());
    if (run.reservation_status === "active") {
      options.tokenGateway.settle(reservation, { inputTokens: cumulativeInputTokens, outputTokens: cumulativeOutputTokens });
      run = markRunReservationTerminal(options.stateDir, run.current.run_id, "settled", now());
      options.afterPhase?.("reservation_terminal");
    }
    const latest = record(run.current.run_id);
    if (!latest.artifacts.some((artifact) => artifact.artifact_id === `text-${result.workerRunId}`)) {
      appendRunArtifact(options.stateDir, run.current.run_id, { artifact_id: `text-${result.workerRunId}`, type: "text", preview: redactTelemetryText(result.rawOutput, 32_000) }, now());
      options.afterPhase?.("artifact");
    }
    const finalized = cancelled
      ? transitionRun(options.stateDir, run.current.run_id, "cancelled", now())
      : finalizeRun(options.stateDir, run.current.run_id, failed ? "failed" : "completed", failed ? result.errorReason ?? `worker_exit_${result.exitCode}` : null, now());
    options.afterPhase?.("finalized");
    options.tokenGateway.acknowledgeTerminal?.(reservation.reservationId);
    return { ...finalized, result };
  }

  function finishDispatchFailure(run: RunRecord): RunRecord {
    const reservation = run.token_reservation!;
    if (run.reservation_status === "active") {
      options.tokenGateway.release(reservation);
      run = markRunReservationTerminal(options.stateDir, run.current.run_id, "released", now());
      options.afterPhase?.("reservation_terminal");
    }
    const finalized = finalizeRun(options.stateDir, run.current.run_id, "failed", run.dispatch_failure, now());
    options.afterPhase?.("finalized");
    options.tokenGateway.acknowledgeTerminal?.(reservation.reservationId);
    return finalized;
  }

  async function runSupervisorOnce(): Promise<(RunRecord & { readonly result: DispatchResult }) | null> {
    for (const terminal of readRunStore(options.stateDir).runs.filter((run) => ["completed", "failed", "cancelled"].includes(run.status) && run.token_reservation !== null && run.reservation_status !== "active")) {
      options.tokenGateway.acknowledgeTerminal?.(terminal.token_reservation!.reservationId);
    }
    const cancellation = readRunStore(options.stateDir).runs.find((run) => run.cancellation_requested && run.status !== "cancelled");
    if (cancellation !== undefined) { cancelRun(cancellation.current.run_id); return null; }
    const failure = readRunStore(options.stateDir).runs.find((run) => run.dispatch_failure !== null && !["completed", "failed", "cancelled"].includes(run.status));
    if (failure !== undefined) {
      const task = options.supervisor.snapshot?.().find((candidate) => candidate.task_id === failure.supervisor_task_id);
      if (task?.status === "failed") { finishDispatchFailure(failure); return null; }
      if (task?.status === "queued") { clearRunDispatchFailure(options.stateDir, failure.current.run_id, now()); }
    }
    const task = taskForPendingResult() ?? options.supervisor.claim(now());
    if (task === null) return null;
    const taskId = task.task_id ?? task.taskId;
    if (taskId === undefined) throw new Error("invalid_supervisor_task");
    let run = bindingForTask(taskId);
    if (run.provider_result !== null) return finishProviderResult(taskId, run, reconstructedResult(run));
    if (run.status === "queued") run = transitionRun(options.stateDir, run.current.run_id, "running", now());
    let result: DispatchResult;
    try {
      result = await options.dispatch(task.handoff, options.stateDir);
    } catch (error) {
      run = recordRunDispatchFailure(options.stateDir, run.current.run_id, error instanceof Error ? error.message.slice(0, 32_000) : "dispatch_failed", now());
      let failed: { readonly status?: string };
      try { failed = options.supervisor.fail(taskId, error instanceof Error ? error.message : "dispatch_failed", now()); }
      catch (failError) {
        const persisted = options.supervisor.snapshot?.().find((item) => item.task_id === taskId);
        if (persisted?.status !== "failed") throw failError;
        failed = persisted;
      }
      if (failed.status === "failed") {
        finishDispatchFailure(run);
      } else {
        clearRunDispatchFailure(options.stateDir, run.current.run_id, now());
      }
      throw error;
    }
    run = persistResult(run, result);
    return finishProviderResult(taskId, run, result);
  }

  function cancelRun(runId: string): RunRecord {
    let current = record(runId);
    if (current.status === "cancelled") return current;
    current = requestRunCancellation(options.stateDir, runId, now());
    const boundTask = current.supervisor_task_id === null ? undefined : options.supervisor.snapshot?.().find((item) => item.task_id === current.supervisor_task_id);
    if (current.status === "running" && (boundTask === undefined || boundTask.status === "running")) return current;
    let firstError: unknown;
    if (current.token_reservation === null) {
      const orphan = options.tokenGateway.findActiveReservation?.(handoffFor(current).handoffId as string) ?? null;
      if (orphan !== null) {
        try { options.tokenGateway.release(orphan); } catch (error) { firstError = error; }
      }
    }
    if (current.supervisor_task_id !== null && current.token_reservation !== null) {
      const task = options.supervisor.snapshot?.().find((item) => item.task_id === current.supervisor_task_id);
      if (task?.status === undefined || !["cancelled", "failed", "completed"].includes(task.status)) {
        try { options.supervisor.cancel(current.supervisor_task_id, "run_cancelled", now()); } catch (error) { firstError = error; }
      }
      if (current.reservation_status === "active") {
        try { options.tokenGateway.release(current.token_reservation); markRunReservationTerminal(options.stateDir, runId, "released", now()); options.tokenGateway.acknowledgeTerminal?.(current.token_reservation.reservationId); }
        catch (error) { firstError ??= error; }
      }
    }
    if (firstError !== undefined) throw firstError;
    return transitionRun(options.stateDir, runId, "cancelled", now());
  }

  return { prepareRun, approveAndQueueRun, runSupervisorOnce, cancelRun };
}
