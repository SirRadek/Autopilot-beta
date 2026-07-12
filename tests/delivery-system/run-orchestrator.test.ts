import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { readRunStore } from "../../src/data/delivery-system/runStore";
import { createRunOrchestrator } from "../../src/data/delivery-system/runOrchestrator";

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
});
