import { randomUUID } from "node:crypto";

import { createApprovalRecord, decideApproval, readApprovalQueue, writeApprovalQueue } from "./approvalQueue";
import { readProviderQuotaStore } from "./providerQuotaStore";
import { resolveEnabledProject } from "./projectRegistry";
import { appendRunArtifact, approveRunRevision, bindRunToSupervisor, clearRunSupervisorBinding, createRunDraft, finalizeRun, markRunReservationTerminal, readRunStore, recordRunProviderResult, transitionRun, type RunDraftInput, type RunRecord, type RunReservation } from "./runStore";
import { estimateTokenCount, type TokenReservation, type TokenReservationRequest, type TokenSettlement } from "./tokenGateway";
import type { GovernedHandoff, DispatchResult } from "../../governed-core/dispatch";
import { computePacketHash } from "../../governed-core/dispatch";
import { buildAgentPacket, loadDecisionMeshFromRoot } from "../../lib/decision-mesh";

interface Gateway {
  reserve(input: TokenReservationRequest): TokenReservation;
  release(reservation: TokenReservation): void;
  settle(reservation: TokenReservation, usage: TokenSettlement): TokenSettlement | void;
}

interface SupervisorTaskView {
  readonly task_id?: string;
  readonly taskId?: string;
  readonly status?: string;
  readonly handoff: GovernedHandoff;
}

interface Supervisor {
  enqueue(input: { readonly taskId: string; readonly handoff: GovernedHandoff; readonly sessionId: string; readonly requiresApproval: true; readonly approvalGranted: true; readonly now: string }): unknown;
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
}) {
  const now = options.now ?? (() => new Date().toISOString());
  function record(runId: string): RunRecord {
    const value = readRunStore(options.stateDir).runs.find((run) => run.current.run_id === runId);
    if (value === undefined) throw new Error("run_not_found");
    return value;
  }

  function routeAvailable(provider: string, model: string | null): boolean {
    if (options.isRouteAvailable !== undefined) return options.isRouteAvailable(provider, model);
    const snapshot = readProviderQuotaStore(options.stateDir).snapshots.find((item) => item.provider === provider);
    return snapshot !== undefined && snapshot.health !== "unavailable" &&
      (model === null || snapshot.models.some((item) => item.model_id === model && item.available && item.health !== "unavailable"));
  }

  function prepareRun(input: RunDraftInput): RunRecord {
    resolveEnabledProject(options.stateDir, input.project_id);
    if (!routeAvailable(input.provider, input.model)) throw new Error("run_route_unavailable");
    const draft = createRunDraft(options.stateDir, input, now());
    const approval = createApprovalRecord({ approvalId: `run-approval-${draft.run_id}-${draft.revision}`, runId: draft.run_id, revision: draft.revision, sessionId: draft.run_id, vendor: draft.provider, ...(draft.model === null ? {} : { model: draft.model }), skillIds: [], prompt: draft.prompt, estimatedTokens: draft.estimated_tokens, now: now() });
    const queue = readApprovalQueue(options.stateDir);
    writeApprovalQueue(options.stateDir, { ...queue, records: [...queue.records, approval] });
    return record(draft.run_id);
  }

  function handoffFor(run: RunRecord): GovernedHandoff {
    const task = run.current.prompt;
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

  function approveAndQueueRun(runId: string, revision: number, operator: string): QueuedRun {
    const before = record(runId);
    if (before.current.revision !== revision || !["draft", "approved"].includes(before.status) || before.supervisor_task_id !== null) throw new Error("run_revision_conflict");
    const queue = readApprovalQueue(options.stateDir);
    const index = queue.records.findIndex((item) => item.run_id === runId && item.revision === revision);
    if (index < 0) throw new Error("approval_not_found");
    const approval = queue.records[index]!;
    if (approval.status === "pending") {
      const decided = decideApproval(approval, "approved", now());
      writeApprovalQueue(options.stateDir, { ...queue, records: queue.records.map((item, candidate) => candidate === index ? decided : item) });
    } else if (approval.status !== "approved") throw new Error("approval_not_approved");
    const approved = approveRunRevision(options.stateDir, runId, revision, operator, now());
    const handoff = handoffFor(approved);
    const inputTokens = Math.min(approved.current.estimated_tokens, estimateTokenCount(approved.current.prompt));
    const reservation = options.tokenGateway.reserve({ provider: approved.current.provider, model: approved.current.model, sessionId: runId, inputTokens, outputTokens: approved.current.estimated_tokens - inputTokens, handoffId: handoff.handoffId as string });
    const taskId = `run-task-${randomUUID()}`;
    bindRunToSupervisor(options.stateDir, runId, taskId, reservation as RunReservation, now());
    try {
      options.supervisor.enqueue({ taskId, handoff, sessionId: runId, requiresApproval: true, approvalGranted: true, now: now() });
    } catch (error) {
      const enqueued = options.supervisor.snapshot?.().find((task) => task.task_id === taskId);
      if (enqueued !== undefined && !["cancelled", "failed", "completed"].includes(enqueued.status ?? "")) options.supervisor.cancel(taskId, "enqueue_failed", now());
      options.tokenGateway.release(reservation);
      clearRunSupervisorBinding(options.stateDir, runId, now());
      throw error;
    }
    let queued: RunRecord;
    try {
      queued = transitionRun(options.stateDir, runId, "queued", now());
    } catch (error) {
      options.supervisor.cancel(taskId, "queue_transition_failed", now());
      options.tokenGateway.release(reservation);
      clearRunSupervisorBinding(options.stateDir, runId, now());
      throw error;
    }
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
      ? { refused: true, reason: result.reason, worker_run_id: null, raw_output: "" }
      : { refused: false, reason: null, worker_run_id: result.workerRunId, raw_output: result.rawOutput }, now());
  }

  function reconstructedResult(run: RunRecord): DispatchResult {
    const result = run.provider_result!;
    if (result.refused) return { refused: true, reason: result.reason as Extract<DispatchResult, { refused: true }>["reason"], tier_id: null, provenance_verified: true };
    return { refused: false, workerRunId: result.worker_run_id!, handoffId: "persisted" as Extract<DispatchResult, { refused: false }>["handoffId"], vendor: run.current.provider, model: run.current.model, exitCode: 0, rawOutput: result.raw_output, parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn", workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true };
  }

  function finishProviderResult(taskId: string, run: RunRecord, result: DispatchResult): RunRecord & { readonly result: DispatchResult } {
    const reservation = run.token_reservation!;
    if (result.refused) {
      options.tokenGateway.release(reservation);
      markRunReservationTerminal(options.stateDir, run.current.run_id, "released", now());
      const task = options.supervisor.snapshot?.().find((item) => item.task_id === taskId);
      if (task?.status === undefined || !["cancelled", "failed", "completed"].includes(task.status)) options.supervisor.cancel(taskId, result.reason, now());
      return { ...finalizeRun(options.stateDir, run.current.run_id, "failed", result.reason, now()), result };
    }
    options.tokenGateway.settle(reservation, { inputTokens: estimateTokenCount(run.current.prompt), outputTokens: estimateTokenCount(result.rawOutput) });
    markRunReservationTerminal(options.stateDir, run.current.run_id, "settled", now());
    const task = options.supervisor.snapshot?.().find((item) => item.task_id === taskId);
    if (task === undefined || task.status === "running") options.supervisor.complete(taskId, now());
    const latest = record(run.current.run_id);
    if (!latest.artifacts.some((artifact) => artifact.artifact_id === `text-${result.workerRunId}`)) appendRunArtifact(options.stateDir, run.current.run_id, { artifact_id: `text-${result.workerRunId}`, type: "text", preview: result.rawOutput }, now());
    return { ...finalizeRun(options.stateDir, run.current.run_id, "completed", null, now()), result };
  }

  async function runSupervisorOnce(): Promise<(RunRecord & { readonly result: DispatchResult }) | null> {
    const task = taskForPendingResult() ?? options.supervisor.claim(now());
    if (task === null) return null;
    const taskId = task.task_id ?? task.taskId;
    if (taskId === undefined) throw new Error("invalid_supervisor_task");
    let run = bindingForTask(taskId);
    if (run.provider_result !== null) return finishProviderResult(taskId, run, reconstructedResult(run));
    let result: DispatchResult;
    try {
      result = await options.dispatch(task.handoff, options.stateDir);
    } catch (error) {
      const failed = options.supervisor.fail(taskId, error instanceof Error ? error.message : "dispatch_failed", now());
      if (failed.status === "failed") {
        options.tokenGateway.release(run.token_reservation!);
        markRunReservationTerminal(options.stateDir, run.current.run_id, "released", now());
        finalizeRun(options.stateDir, run.current.run_id, "failed", error instanceof Error ? error.message : "dispatch_failed", now());
      }
      throw error;
    }
    run = persistResult(run, result);
    return finishProviderResult(taskId, run, result);
  }

  function cancelRun(runId: string): RunRecord {
    const current = record(runId);
    if (current.status === "cancelled") return current;
    if (current.supervisor_task_id !== null && current.token_reservation !== null) {
      const task = options.supervisor.snapshot?.().find((item) => item.task_id === current.supervisor_task_id);
      if (task?.status === undefined || !["cancelled", "failed", "completed"].includes(task.status)) options.supervisor.cancel(current.supervisor_task_id, "run_cancelled", now());
      if (current.reservation_status === "active") {
        options.tokenGateway.release(current.token_reservation);
        markRunReservationTerminal(options.stateDir, runId, "released", now());
      }
    }
    return transitionRun(options.stateDir, runId, "cancelled", now());
  }

  return { prepareRun, approveAndQueueRun, runSupervisorOnce, cancelRun };
}
