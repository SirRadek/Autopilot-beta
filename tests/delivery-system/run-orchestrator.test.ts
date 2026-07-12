import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { readRunStore } from "../../src/data/delivery-system/runStore";
import { createRunOrchestrator } from "../../src/data/delivery-system/runOrchestrator";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../../src/data/delivery-system/tokenGateway";

const now = "2026-07-13T10:00:00.000Z";

function setup(options: { dispatch?: ReturnType<typeof vi.fn>; reserve?: ReturnType<typeof vi.fn>; enqueue?: ReturnType<typeof vi.fn> } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-"));
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true }] });
  const reservation = { reservationId: "reservation-1", provider: "codex_cli", model: "gpt-5", sessionId: "run", inputTokens: 10, outputTokens: 90, totalTokens: 100, reservedAt: now };
  const tokenGateway = {
    reserve: options.reserve ?? vi.fn((request) => ({ ...reservation, ...request })),
    release: vi.fn(),
    settle: vi.fn()
  };
  const tasks: Array<Record<string, unknown>> = [];
  const supervisor = {
    enqueue: options.enqueue ?? vi.fn((input) => { tasks.push({ ...input, status: "queued", attempt: 0 }); return { ...input, status: "queued", attempt: 0 }; }),
    claim: vi.fn(() => tasks.shift() ?? null),
    complete: vi.fn(),
    fail: vi.fn((_id, _reason) => ({ status: "queued" })),
    cancel: vi.fn()
  };
  const dispatch = options.dispatch ?? vi.fn(async () => ({ refused: false, workerRunId: "worker-1", rawOutput: "text result", exitCode: 0, model: "gpt-5" }));
  type OrchestratorOptions = Parameters<typeof createRunOrchestrator>[0];
  const orchestrator = createRunOrchestrator({
    stateDir,
    tokenGateway: tokenGateway as unknown as OrchestratorOptions["tokenGateway"],
    supervisor: supervisor as unknown as OrchestratorOptions["supervisor"],
    dispatch: dispatch as unknown as OrchestratorOptions["dispatch"],
    now: () => now,
    isRouteAvailable: () => true
  });
  const input = { project_id: "alpha", prompt: "build it", provider: "codex_cli" as const, model: "gpt-5", estimated_tokens: 100, requested_artifacts: ["text", "visual"] as const };
  return { stateDir, tokenGateway, supervisor, dispatch, orchestrator, input };
}

describe("governed run orchestration", () => {
  it("does not reserve or enqueue before approval", () => {
    const { orchestrator, input, tokenGateway, supervisor } = setup();
    const run = orchestrator.prepareRun(input);
    expect(run.status).toBe("draft");
    expect(tokenGateway.reserve).not.toHaveBeenCalled();
    expect(supervisor.enqueue).not.toHaveBeenCalled();
  });

  it("binds approval, reservation and handoff to the same route", () => {
    const { orchestrator, input, tokenGateway, supervisor } = setup();
    const draft = orchestrator.prepareRun(input);
    const queued = orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    expect(tokenGateway.reserve).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex_cli", model: "gpt-5", sessionId: draft.current.run_id }));
    expect(supervisor.enqueue).toHaveBeenCalledWith(expect.objectContaining({ taskId: queued.supervisor_task_id, requiresApproval: true, approvalGranted: true }));
    expect(queued.status).toBe("queued");
  });

  it("rejects stale revisions before reserving", () => {
    const { orchestrator, input, tokenGateway } = setup();
    const draft = orchestrator.prepareRun(input);
    expect(() => orchestrator.approveAndQueueRun(draft.current.run_id, 2, "owner")).toThrow("run_revision_conflict");
    expect(tokenGateway.reserve).not.toHaveBeenCalled();
  });

  it("leaves approval unqueued when the gateway refuses", () => {
    const reserve = vi.fn(() => { throw new Error("token_budget_exhausted"); });
    const { orchestrator, input, supervisor } = setup({ reserve });
    const draft = orchestrator.prepareRun(input);
    expect(() => orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("token_budget_exhausted");
    expect(supervisor.enqueue).not.toHaveBeenCalled();
  });

  it("releases a reservation exactly once when enqueue fails", () => {
    const enqueue = vi.fn(() => { throw new Error("queue_full"); });
    const { orchestrator, input, tokenGateway } = setup({ enqueue });
    const draft = orchestrator.prepareRun(input);
    expect(() => orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("queue_full");
    expect(tokenGateway.release).toHaveBeenCalledTimes(1);
  });

  it("settles once on success and ignores unsupported visual output", async () => {
    const { orchestrator, input, tokenGateway, stateDir } = setup();
    const draft = orchestrator.prepareRun(input);
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const result = await orchestrator.runSupervisorOnce();
    expect(result?.status).toBe("completed");
    expect(tokenGateway.settle).toHaveBeenCalledTimes(1);
    expect(tokenGateway.release).not.toHaveBeenCalled();
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ status: "completed", artifacts: [{ type: "text", preview: "text result" }] });
  });

  it("releases once when a governed refusal is terminal", async () => {
    const dispatch = vi.fn(async () => ({ refused: true as const, reason: "routing_no_viable_provider" as const, tier_id: null, provenance_verified: true }));
    const context = setup({ dispatch });
    context.supervisor.fail.mockReturnValue({ status: "failed" });
    const draft = context.orchestrator.prepareRun(context.input);
    context.orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const result = await context.orchestrator.runSupervisorOnce();
    expect(result?.status).toBe("failed");
    expect(context.tokenGateway.release).toHaveBeenCalledTimes(1);
    expect(context.tokenGateway.settle).not.toHaveBeenCalled();
  });

  it("retries the same approved route and settles only at terminal completion", async () => {
    const dispatch = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ refused: false, workerRunId: "worker-2", rawOutput: "done", exitCode: 0, model: "gpt-5" });
    const { orchestrator, input, tokenGateway, supervisor } = setup({ dispatch });
    const draft = orchestrator.prepareRun(input);
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    await expect(orchestrator.runSupervisorOnce()).rejects.toThrow("temporary");
    expect(tokenGateway.settle).not.toHaveBeenCalled();
    expect(tokenGateway.release).not.toHaveBeenCalled();
    supervisor.claim.mockReturnValueOnce({ ...supervisor.enqueue.mock.calls[0]![0], status: "running", attempt: 2 });
    await orchestrator.runSupervisorOnce();
    expect(dispatch.mock.calls[0]![0]).toEqual(dispatch.mock.calls[1]![0]);
    expect(tokenGateway.settle).toHaveBeenCalledTimes(1);
  });

  it("releases exactly once when cancelled before dispatch", () => {
    const { orchestrator, input, tokenGateway } = setup();
    const draft = orchestrator.prepareRun(input);
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    expect(orchestrator.cancelRun(draft.current.run_id).status).toBe("cancelled");
    expect(tokenGateway.release).toHaveBeenCalledTimes(1);
    orchestrator.cancelRun(draft.current.run_id);
    expect(tokenGateway.release).toHaveBeenCalledTimes(1);
  });

  it("reconstructs the durable route and completes after restart without reserving twice", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-restart-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true }] });
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-restart", handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5", exitCode: 0, rawOutput: "restarted", parsedJson: null, durationSeconds: 1, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
    const firstGateway = new TokenGateway({ stateDir });
    const first = createRunOrchestrator({ stateDir, tokenGateway: firstGateway, supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "restart me", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, requested_artifacts: ["text"] });
    const queued = first.approveAndQueueRun(draft.current.run_id, 1, "owner");

    const secondGateway = new TokenGateway({ stateDir });
    const second = createRunOrchestrator({ stateDir, tokenGateway: secondGateway, supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    expect((await second.runSupervisorOnce())?.status).toBe("completed");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ supervisor_task_id: queued.supervisor_task_id, worker_run_id: "worker-restart", status: "completed" });
    expect(secondGateway.snapshot().activeReservations).toBe(0);
  });

  it("cancels durable supervisor work and releases after restart exactly once", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-cancel-restart-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true }] });
    const dispatch = vi.fn();
    const first = createRunOrchestrator({ stateDir, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "cancel me", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const gateway = new TokenGateway({ stateDir });
    const supervisor = new SupervisorQueue({ stateDir });
    const second = createRunOrchestrator({ stateDir, tokenGateway: gateway, supervisor, dispatch, now: () => now, isRouteAvailable: () => true });
    expect(second.cancelRun(draft.current.run_id).status).toBe("cancelled");
    expect(second.cancelRun(draft.current.run_id).status).toBe("cancelled");
    expect(supervisor.snapshot()[0]?.status).toBe("cancelled");
    expect(gateway.snapshot().activeReservations).toBe(0);
  });

  it("does not redispatch when settlement succeeded before a persistence fault", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-settle-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    let fault = true;
    const gateway = { reserve: realGateway.reserve.bind(realGateway), release: realGateway.release.bind(realGateway), settle: (...args: Parameters<TokenGateway["settle"]>) => { const value = realGateway.settle(...args); if (fault) { fault = false; throw new Error("after_settlement"); } return value; } };
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-once", handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5", exitCode: 0, rawOutput: "once", parsedJson: null, durationSeconds: 1, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
    const first = createRunOrchestrator({ stateDir, tokenGateway: gateway, supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "once", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    await expect(first.runSupervisorOnce()).rejects.toThrow("after_settlement");
    const second = createRunOrchestrator({ stateDir, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    await second.runSupervisorOnce();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readRunStore(stateDir).runs[0]?.status).toBe("completed");
  });

  it("reuses the reservation when reserve committed before an injected throw", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-reserve-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    let fault = true;
    const gateway = { reserve: (input: Parameters<TokenGateway["reserve"]>[0]) => { const value = realGateway.reserve(input); if (fault) { fault = false; throw new Error("after_reserve"); } return value; }, release: realGateway.release.bind(realGateway), settle: realGateway.settle.bind(realGateway) };
    const orchestrator = createRunOrchestrator({ stateDir, tokenGateway: gateway, supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = orchestrator.prepareRun({ project_id: "alpha", prompt: "reserve once", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, requested_artifacts: ["text"] });
    expect(() => orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_reserve");
    expect(orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner").status).toBe("queued");
    expect(realGateway.snapshot().activeReservations).toBe(1);
  });

  it("cancels a task when enqueue committed before an injected throw", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-enqueue-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true }] });
    const supervisor = new SupervisorQueue({ stateDir });
    const throwingSupervisor = {
      enqueue: (input: Parameters<SupervisorQueue["enqueue"]>[0]) => { supervisor.enqueue(input); throw new Error("after_enqueue"); },
      claim: supervisor.claim.bind(supervisor), complete: supervisor.complete.bind(supervisor), fail: supervisor.fail.bind(supervisor),
      cancel: supervisor.cancel.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor)
    };
    const gateway = new TokenGateway({ stateDir });
    const orchestrator = createRunOrchestrator({ stateDir, tokenGateway: gateway, supervisor: throwingSupervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = orchestrator.prepareRun({ project_id: "alpha", prompt: "enqueue once", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, requested_artifacts: ["text"] });
    expect(() => orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_enqueue");
    expect(supervisor.snapshot()[0]?.status).toBe("cancelled");
    expect(gateway.snapshot().activeReservations).toBe(0);
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ status: "approved", supervisor_task_id: null });
  });

  it("finishes cancellation after release committed before an injected throw", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-cancel-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: "/work/alpha", enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    const supervisor = new SupervisorQueue({ stateDir });
    const first = createRunOrchestrator({ stateDir, tokenGateway: realGateway, supervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "cancel fault", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const throwingGateway = { reserve: realGateway.reserve.bind(realGateway), settle: realGateway.settle.bind(realGateway), release: (reservation: Parameters<TokenGateway["release"]>[0]) => { realGateway.release(reservation); throw new Error("after_release"); } };
    const faulty = createRunOrchestrator({ stateDir, tokenGateway: throwingGateway, supervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(() => faulty.cancelRun(draft.current.run_id)).toThrow("after_release");
    const recovered = createRunOrchestrator({ stateDir, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(recovered.cancelRun(draft.current.run_id).status).toBe("cancelled");
    expect(new TokenGateway({ stateDir }).snapshot().activeReservations).toBe(0);
  });
});
