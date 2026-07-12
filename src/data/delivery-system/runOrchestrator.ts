import { randomUUID } from "node:crypto";

import { createApprovalRecord, decideApproval, readApprovalQueue, writeApprovalQueue } from "./approvalQueue";
import { readProviderQuotaStore } from "./providerQuotaStore";
import { resolveEnabledProject } from "./projectRegistry";
import { appendRunArtifact, approveRunRevision, createRunDraft, readRunStore, transitionRun, type RunDraftInput, type RunRecord } from "./runStore";
import { estimateTokenCount, type TokenReservation, type TokenReservationRequest, type TokenSettlement } from "./tokenGateway";
import type { GovernedHandoff, DispatchResult } from "../../governed-core/dispatch";
import { computePacketHash } from "../../governed-core/dispatch";
import { buildAgentPacket, loadDecisionMeshFromRoot } from "../../lib/decision-mesh";

interface Gateway {
  reserve(input: TokenReservationRequest): TokenReservation;
  release(reservation: TokenReservation): void;
  settle(reservation: TokenReservation, usage: TokenSettlement): TokenSettlement | void;
}

interface Supervisor {
  enqueue(input: { readonly taskId: string; readonly handoff: GovernedHandoff; readonly sessionId: string; readonly requiresApproval: true; readonly approvalGranted: true; readonly now: string }): unknown;
  claim(now: string): ({ readonly task_id?: string; readonly taskId?: string; readonly handoff: GovernedHandoff } & Record<string, unknown>) | null;
  complete(taskId: string, now?: string): unknown;
  fail(taskId: string, reason: string, now?: string): { readonly status?: string };
  cancel(taskId: string, reason?: string, now?: string): unknown;
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
  const bindings = new Map<string, { runId: string; taskId: string; reservation: TokenReservation; handoff: GovernedHandoff; terminal: boolean }>();

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
    if (before.status !== "draft" || before.current.revision !== revision) throw new Error("run_revision_conflict");
    const queue = readApprovalQueue(options.stateDir);
    const index = queue.records.findIndex((item) => item.run_id === runId && item.revision === revision);
    if (index < 0) throw new Error("approval_not_found");
    const decided = decideApproval(queue.records[index]!, "approved", now());
    writeApprovalQueue(options.stateDir, { ...queue, records: queue.records.map((item, candidate) => candidate === index ? decided : item) });
    const approved = approveRunRevision(options.stateDir, runId, revision, operator, now());
    const handoff = handoffFor(approved);
    const inputTokens = Math.min(approved.current.estimated_tokens, estimateTokenCount(approved.current.prompt));
    const reservation = options.tokenGateway.reserve({ provider: approved.current.provider, model: approved.current.model, sessionId: runId, inputTokens, outputTokens: approved.current.estimated_tokens - inputTokens, handoffId: handoff.handoffId as string });
    const taskId = `run-task-${randomUUID()}`;
    try {
      options.supervisor.enqueue({ taskId, handoff, sessionId: runId, requiresApproval: true, approvalGranted: true, now: now() });
    } catch (error) {
      options.tokenGateway.release(reservation);
      throw error;
    }
    bindings.set(taskId, { runId, taskId, reservation, handoff, terminal: false });
    const queued = transitionRun(options.stateDir, runId, "queued", now());
    return { ...queued, supervisor_task_id: taskId };
  }

  async function runSupervisorOnce(): Promise<(RunRecord & { readonly result: DispatchResult }) | null> {
    const task = options.supervisor.claim(now());
    if (task === null) return null;
    const taskId = task.task_id ?? task.taskId;
    if (taskId === undefined) throw new Error("invalid_supervisor_task");
    const binding = bindings.get(taskId);
    if (binding === undefined) throw new Error("run_binding_not_found");
    let result: DispatchResult;
    try {
      result = await options.dispatch(task.handoff, options.stateDir);
    } catch (error) {
      const failed = options.supervisor.fail(taskId, error instanceof Error ? error.message : "dispatch_failed", now());
      if (failed.status === "failed" && !binding.terminal) {
        options.tokenGateway.release(binding.reservation);
        binding.terminal = true;
        transitionRun(options.stateDir, binding.runId, "running", now());
        transitionRun(options.stateDir, binding.runId, "failed", now());
      }
      throw error;
    }
    if (result.refused) {
      const failed = options.supervisor.fail(taskId, result.reason, now());
      if (failed.status === "failed") {
        options.tokenGateway.release(binding.reservation);
        binding.terminal = true;
        transitionRun(options.stateDir, binding.runId, "running", now());
        return { ...transitionRun(options.stateDir, binding.runId, "failed", now()), result };
      }
      return { ...record(binding.runId), result };
    }
    try {
      options.tokenGateway.settle(binding.reservation, { inputTokens: estimateTokenCount(binding.handoff.prompt), outputTokens: estimateTokenCount(result.rawOutput) });
    } catch (error) {
      options.tokenGateway.release(binding.reservation);
      binding.terminal = true;
      options.supervisor.fail(taskId, error instanceof Error ? error.message : "token_settlement_failed", now());
      transitionRun(options.stateDir, binding.runId, "running", now());
      transitionRun(options.stateDir, binding.runId, "failed", now());
      throw error;
    }
    binding.terminal = true;
    options.supervisor.complete(taskId, now());
    appendRunArtifact(options.stateDir, binding.runId, { artifact_id: `text-${result.workerRunId}`, type: "text", preview: result.rawOutput }, now());
    transitionRun(options.stateDir, binding.runId, "running", now());
    return { ...transitionRun(options.stateDir, binding.runId, "completed", now()), result };
  }

  function cancelRun(runId: string): RunRecord {
    const current = record(runId);
    if (current.status === "cancelled") return current;
    const binding = [...bindings.values()].find((item) => item.runId === runId);
    if (binding !== undefined && !binding.terminal) {
      options.supervisor.cancel(binding.taskId, "run_cancelled", now());
      options.tokenGateway.release(binding.reservation);
      binding.terminal = true;
    }
    return transitionRun(options.stateDir, runId, "cancelled", now());
  }

  return { prepareRun, approveAndQueueRun, runSupervisorOnce, cancelRun };
}
