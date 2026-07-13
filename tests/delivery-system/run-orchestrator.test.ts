import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { readRunStore } from "../../src/data/delivery-system/runStore";
import { createRunOrchestrator } from "../../src/data/delivery-system/runOrchestrator";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../../src/data/delivery-system/tokenGateway";

const now = "2026-07-13T10:00:00.000Z";
const fixtureProjectRoot = mkdtempSync(join(tmpdir(), "run-orchestrator-projects-"));
const fixtureProjectCwd = join(fixtureProjectRoot, "alpha");
mkdirSync(fixtureProjectCwd);

function linkDirectory(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

function setup(options: { dispatch?: ReturnType<typeof vi.fn>; reserve?: ReturnType<typeof vi.fn>; enqueue?: ReturnType<typeof vi.fn>; projectRoot?: string; projectCwd?: string } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-"));
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: options.projectCwd ?? fixtureProjectCwd, enabled: true }] });
  const reservation = { reservationId: "reservation-1", provider: "codex_cli", model: "gpt-5", sessionId: "run", inputTokens: 10, outputTokens: 90, totalTokens: 100, reservedAt: now };
  const tokenGateway = {
    reserve: options.reserve ?? vi.fn((request) => ({ ...reservation, ...request, totalTokens: request.inputTokens + request.outputTokens })),
    release: vi.fn(),
    settle: vi.fn()
  };
  const tasks: Array<Record<string, unknown>> = [];
  const supervisor = {
    enqueue: options.enqueue ?? vi.fn((input) => { tasks.push({ ...input, status: "queued", attempt: 0 }); return { ...input, status: "queued", attempt: 0 }; }),
    peekClaimable: vi.fn(() => tasks[0] ?? null),
    claim: vi.fn(() => tasks.shift() ?? null),
    complete: vi.fn(),
    fail: vi.fn((_id, _reason) => ({ status: "queued" })),
    cancel: vi.fn(),
    snapshot: vi.fn(() => structuredClone(tasks))
  };
  const dispatch = options.dispatch ?? vi.fn(async () => ({ refused: false, workerRunId: "worker-1", rawOutput: "text result", exitCode: 0, model: "gpt-5" }));
  type OrchestratorOptions = Parameters<typeof createRunOrchestrator>[0];
  const orchestrator = createRunOrchestrator({
    stateDir,
    tokenGateway: tokenGateway as unknown as OrchestratorOptions["tokenGateway"],
    supervisor: supervisor as unknown as OrchestratorOptions["supervisor"],
    dispatch: dispatch as unknown as OrchestratorOptions["dispatch"],
    now: () => now,
    isRouteAvailable: () => true,
    projectRoot: options.projectRoot ?? fixtureProjectRoot
  });
  const input = { project_id: "alpha", prompt: "build it", provider: "codex_cli" as const, model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text", "visual"] as const };
  return { stateDir, tokenGateway, supervisor, dispatch, orchestrator, input };
}

describe("governed run orchestration", () => {
  it("does not dispatch an out-of-root project when projectRoot is omitted", () => {
    const fixture = mkdtempSync(join(tmpdir(), "run-orchestrator-default-root-"));
    const stateDir = join(fixture, "state");
    const projectRoot = join(fixture, "projects");
    const outside = join(fixture, "outside");
    mkdirSync(stateDir);
    mkdirSync(projectRoot);
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: outside, enabled: true }] });
    const dispatch = vi.fn();
    const previous = process.env.AUTOPILOT_PROJECTS_DIR;
    process.env.AUTOPILOT_PROJECTS_DIR = projectRoot;
    try {
      const orchestrator = createRunOrchestrator({
        stateDir,
        tokenGateway: new TokenGateway({ stateDir }),
        supervisor: new SupervisorQueue({ stateDir }),
        dispatch,
        isRouteAvailable: () => true
      });

      expect(() => orchestrator.prepareRun({ project_id: "alpha", prompt: "blocked", provider: "codex_cli", model: null, estimated_tokens: 20_000, requested_artifacts: ["text"] }))
        .toThrow("project_path_outside_root");
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.AUTOPILOT_PROJECTS_DIR;
      else process.env.AUTOPILOT_PROJECTS_DIR = previous;
    }
  });

  it("leaves the next unsafe recovered task queued until its project is corrected", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "run-orchestrator-recovered-root-"));
    const stateDir = join(fixture, "state");
    const projectRoot = join(fixture, "projects");
    const inside = join(projectRoot, "inside");
    const outside = join(fixture, "outside");
    mkdirSync(stateDir);
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside);
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: outside, enabled: true }] });
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-recovered", handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5", exitCode: 0, rawOutput: "done", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
    const first = createRunOrchestrator({ stateDir, projectRoot: fixture, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "recover safely", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, draft.current.revision, "owner");
    const supervisor = new SupervisorQueue({ stateDir });
    const restarted = createRunOrchestrator({ stateDir, projectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor, dispatch, now: () => now, isRouteAvailable: () => true });
    const runBefore = readRunStore(stateDir).runs[0];
    const taskBefore = supervisor.snapshot()[0];
    const reservationsBefore = new TokenGateway({ stateDir }).snapshot();

    expect(await restarted.runSupervisorOnce()).toBeNull();
    expect(readRunStore(stateDir).runs[0]).toEqual(runBefore);
    expect(supervisor.snapshot()[0]).toEqual(taskBefore);
    expect(new TokenGateway({ stateDir }).snapshot()).toEqual(reservationsBefore);
    expect(runBefore).toMatchObject({ status: "queued", reservation_status: "active" });
    expect(taskBefore).toMatchObject({ status: "queued", attempt: 0 });
    expect(dispatch).not.toHaveBeenCalled();

    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: inside, enabled: true }] });
    expect((await restarted.runSupervisorOnce())?.status).toBe("completed");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("rechecks a queued symlink and dispatches only its latest canonical in-root target", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "run-orchestrator-root-"));
    const projectRoot = join(fixture, "projects");
    const firstTarget = join(projectRoot, "first");
    const secondTarget = join(projectRoot, "second");
    const projectLink = join(projectRoot, "active");
    mkdirSync(firstTarget, { recursive: true });
    mkdirSync(secondTarget);
    linkDirectory(firstTarget, projectLink);
    const context = setup({ projectRoot, projectCwd: projectLink });
    const draft = context.orchestrator.prepareRun(context.input);
    context.orchestrator.approveAndQueueRun(draft.current.run_id, draft.current.revision, "owner");
    unlinkSync(projectLink);
    linkDirectory(secondTarget, projectLink);

    await context.orchestrator.runSupervisorOnce();

    expect(context.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: realpathSync(secondTarget) }),
      context.stateDir
    );
  });

  it("leaves an injected supervisor task unchanged until its escaped project is corrected", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "run-orchestrator-root-"));
    const projectRoot = join(fixture, "projects");
    const firstTarget = join(projectRoot, "first");
    const outside = join(fixture, "outside");
    const projectLink = join(projectRoot, "active");
    mkdirSync(firstTarget, { recursive: true });
    mkdirSync(outside);
    linkDirectory(firstTarget, projectLink);
    const context = setup({ projectRoot, projectCwd: projectLink });
    const draft = context.orchestrator.prepareRun(context.input);
    context.orchestrator.approveAndQueueRun(draft.current.run_id, draft.current.revision, "owner");
    const runBefore = readRunStore(context.stateDir).runs[0];
    const taskBefore = context.supervisor.snapshot()[0];
    const reservationBefore = structuredClone(runBefore?.token_reservation);
    unlinkSync(projectLink);
    linkDirectory(outside, projectLink);

    expect(await context.orchestrator.runSupervisorOnce()).toBeNull();
    expect(readRunStore(context.stateDir).runs[0]).toEqual(runBefore);
    expect(context.supervisor.snapshot()[0]).toEqual(taskBefore);
    expect(readRunStore(context.stateDir).runs[0]?.token_reservation).toEqual(reservationBefore);
    expect(taskBefore).toMatchObject({ status: "queued", attempt: 0 });
    expect(context.tokenGateway.release).not.toHaveBeenCalled();
    expect(context.tokenGateway.settle).not.toHaveBeenCalled();
    expect(context.dispatch).not.toHaveBeenCalled();

    unlinkSync(projectLink);
    linkDirectory(firstTarget, projectLink);
    expect((await context.orchestrator.runSupervisorOnce())?.status).toBe("completed");
    expect(context.dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not reserve or enqueue before approval", () => {
    const { orchestrator, input, tokenGateway, supervisor } = setup();
    const run = orchestrator.prepareRun(input);
    expect(run.status).toBe("draft");
    expect(tokenGateway.reserve).not.toHaveBeenCalled();
    expect(supervisor.enqueue).not.toHaveBeenCalled();
  });

  it("rejects Unicode prompts that exceed the conservative handoff bound outside HTTP", () => {
    const { orchestrator, input } = setup();
    for (const prompt of ["界".repeat(3_001), "😀".repeat(2_251), "e\u0301".repeat(4_501)]) {
      expect(() => orchestrator.prepareRun({ ...input, prompt, prompt_review_acknowledged: true })).toThrow("run_prompt_token_cap_exceeded");
    }
  });

  it("persists review acknowledgement immutably and requires it above the review bound", () => {
    const { orchestrator, input, stateDir } = setup();
    const prompt = "界".repeat(334);
    expect(() => orchestrator.prepareRun({ ...input, prompt })).toThrow("run_prompt_review_required");
    const draft = orchestrator.prepareRun({ ...input, prompt, estimated_tokens: 20_000, prompt_review_acknowledged: true });
    expect(draft.current.prompt_review_acknowledged).toBe(true);
    expect(readRunStore(stateDir).runs[0]?.revisions[0]?.prompt_review_acknowledged).toBe(true);
  });

  it("binds approval, reservation and handoff to the same route", () => {
    const { orchestrator, input, tokenGateway, supervisor } = setup();
    const draft = orchestrator.prepareRun(input);
    const queued = orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    expect(tokenGateway.reserve).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex_cli", model: "gpt-5", sessionId: draft.current.run_id }));
    expect(supervisor.enqueue).toHaveBeenCalledWith(expect.objectContaining({ taskId: queued.supervisor_task_id, requiresApproval: true, approvalGranted: true }));
    expect(queued.status).toBe("queued");
    expect(queued.token_reservation?.totalTokens).toBe(queued.current.estimated_tokens);
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

  it("fails a nonzero worker result while settling its actual usage", async () => {
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-failed", rawOutput: "password=pw authorization: Bearer bt api_key=ak", exitCode: 7, errorReason: "provider_failed", lockStatus: "failed" as const, model: "gpt-5" }));
    const { orchestrator, input, tokenGateway, stateDir, supervisor } = setup({ dispatch });
    supervisor.fail.mockReturnValue({ status: "failed" });
    const draft = orchestrator.prepareRun(input);
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const result = await orchestrator.runSupervisorOnce();
    expect(result?.status).toBe("failed");
    expect(tokenGateway.settle).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(readRunStore(stateDir))).not.toContain("password=pw");
    expect(JSON.stringify(readRunStore(stateDir))).not.toContain("Bearer bt");
    expect(JSON.stringify(readRunStore(stateDir))).not.toContain("api_key=ak");
    expect(readRunStore(stateDir).runs[0]?.provider_result).toMatchObject({ exit_code: 7, error_reason: "provider_failed" });
  });

  it("retries a failed worker result on the same route before succeeding", async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce({ refused: false, workerRunId: "worker-failed", rawOutput: "failed output", exitCode: 1, errorReason: "retryable", lockStatus: "acquired_supervisor_spawn", model: "gpt-5" })
      .mockResolvedValueOnce({ refused: false, workerRunId: "worker-ok", rawOutput: "success", exitCode: 0, errorReason: null, lockStatus: "acquired_supervisor_spawn", model: "gpt-5" });
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const tokenGateway = new TokenGateway({ stateDir });
    const settle = vi.spyOn(tokenGateway, "settle");
    const orchestrator = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway, supervisor: new SupervisorQueue({ stateDir, baseRetryDelayMs: 0, maxRetryDelayMs: 0 }), dispatch: dispatch as any, now: () => now, isRouteAvailable: () => true });
    const draft = orchestrator.prepareRun({ project_id: "alpha", prompt: "build it", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    expect(await orchestrator.runSupervisorOnce()).toBeNull();
    await orchestrator.runSupervisorOnce();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toEqual(dispatch.mock.calls[1]?.[0]);
    expect(settle).toHaveBeenCalledWith(expect.anything(), { inputTokens: 16, outputTokens: 20 });
    expect(readRunStore(stateDir).runs[0]?.reservation_status).toBe("settled");
  });

  it("terminalizes worker failure only after retry exhaustion", async () => {
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-failed", rawOutput: "failed", exitCode: 1, errorReason: "failed", lockStatus: "failed" as const, model: "gpt-5" }));
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const orchestrator = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir, baseRetryDelayMs: 0, maxRetryDelayMs: 0 }), dispatch: dispatch as any, now: () => now, isRouteAvailable: () => true, supervisorMaxAttempts: 2 });
    const draft = orchestrator.prepareRun({ project_id: "alpha", prompt: "fail", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    expect(await orchestrator.runSupervisorOnce()).toBeNull();
    expect((await orchestrator.runSupervisorOnce())?.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("stops retries when cumulative actual usage exhausts the approved budget", async () => {
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-large", rawOutput: "x".repeat(8_193), exitCode: 1, errorReason: "retryable", lockStatus: "failed" as const, model: "gpt-5" }));
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const orchestrator = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir, baseRetryDelayMs: 0, maxRetryDelayMs: 0 }), dispatch: dispatch as any, now: () => now, isRouteAvailable: () => true });
    const draft = orchestrator.prepareRun({ project_id: "alpha", prompt: "x", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    expect((await orchestrator.runSupervisorOnce())?.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ reservation_status: "released", terminal_reason: "token_settlement_exceeds_reservation" });
  });

  it("accepts the exact output allowance boundary and rejects one byte beyond it", async () => {
    for (const [size, expected] of [[8_192, "completed"], [8_193, "failed"]] as const) {
      const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-boundary-"));
      writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
      const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: `worker-${size}`, rawOutput: "x".repeat(size), exitCode: 0, errorReason: null, lockStatus: "acquired_supervisor_spawn" as const, model: "gpt-5" }));
      const orchestrator = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: dispatch as any, now: () => now, isRouteAvailable: () => true });
      const draft = orchestrator.prepareRun({ project_id: "alpha", prompt: "x", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
      const queued = orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
      expect(queued.token_reservation).toMatchObject({ inputTokens: 1, outputTokens: 8_192, totalTokens: 8_193 });
      expect((await orchestrator.runSupervisorOnce())?.status).toBe(expected);
    }
  });

  it("keeps a running cancellation durable until dispatch finishes", async () => {
    let resolveDispatch!: (value: any) => void;
    const dispatch = vi.fn(() => new Promise((resolve) => { resolveDispatch = resolve; }));
    const { orchestrator, input, tokenGateway, stateDir } = setup({ dispatch });
    const draft = orchestrator.prepareRun(input);
    orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const pending = orchestrator.runSupervisorOnce();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(orchestrator.cancelRun(draft.current.run_id).status).not.toBe("cancelled");
    expect(tokenGateway.release).not.toHaveBeenCalled();
    resolveDispatch({ refused: false, workerRunId: "worker-1", rawOutput: "used", exitCode: 0, errorReason: null, lockStatus: "acquired_supervisor_spawn", model: "gpt-5" });
    expect((await pending)?.status).toBe("cancelled");
    expect(tokenGateway.settle).toHaveBeenCalledTimes(1);
    expect(readRunStore(stateDir).runs[0]?.status).toBe("cancelled");
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
    const retryTask = { ...supervisor.enqueue.mock.calls[0]![0], status: "running", attempt: 2 };
    supervisor.peekClaimable.mockReturnValueOnce(retryTask);
    supervisor.claim.mockReturnValueOnce(retryTask);
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
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-restart", handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5", exitCode: 0, rawOutput: "restarted", parsedJson: null, durationSeconds: 1, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
    const firstGateway = new TokenGateway({ stateDir });
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: firstGateway, supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "restart me", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    const queued = first.approveAndQueueRun(draft.current.run_id, 1, "owner");

    const secondGateway = new TokenGateway({ stateDir });
    const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: secondGateway, supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    expect((await second.runSupervisorOnce())?.status).toBe("completed");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ supervisor_task_id: queued.supervisor_task_id, worker_run_id: "worker-restart", status: "completed" });
    expect(secondGateway.snapshot().activeReservations).toBe(0);
  });

  it("cancels durable supervisor work and releases after restart exactly once", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-cancel-restart-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const dispatch = vi.fn();
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "cancel me", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const gateway = new TokenGateway({ stateDir });
    const supervisor = new SupervisorQueue({ stateDir });
    const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor, dispatch, now: () => now, isRouteAvailable: () => true });
    expect(second.cancelRun(draft.current.run_id).status).toBe("cancelled");
    expect(second.cancelRun(draft.current.run_id).status).toBe("cancelled");
    expect(supervisor.snapshot()[0]?.status).toBe("cancelled");
    expect(gateway.snapshot().activeReservations).toBe(0);
  });

  it("does not redispatch when settlement succeeded before a persistence fault", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-settle-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    let fault = true;
    const gateway = { reserve: realGateway.reserve.bind(realGateway), release: realGateway.release.bind(realGateway), settle: (...args: Parameters<TokenGateway["settle"]>) => { const value = realGateway.settle(...args); if (fault) { fault = false; throw new Error("after_settlement"); } return value; } };
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-once", handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5", exitCode: 0, rawOutput: "once", parsedJson: null, durationSeconds: 1, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "once", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    await expect(first.runSupervisorOnce()).rejects.toThrow("after_settlement");
    const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    await second.runSupervisorOnce();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readRunStore(stateDir).runs[0]?.status).toBe("completed");
  });

  it("reuses the reservation when reserve committed before an injected throw", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-reserve-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    let fault = true;
    const gateway = { reserve: (input: Parameters<TokenGateway["reserve"]>[0]) => { const value = realGateway.reserve(input); if (fault) { fault = false; throw new Error("after_reserve"); } return value; }, release: realGateway.release.bind(realGateway), settle: realGateway.settle.bind(realGateway) };
    const orchestrator = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = orchestrator.prepareRun({ project_id: "alpha", prompt: "reserve once", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_reserve");
    expect(orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner").status).toBe("queued");
    expect(realGateway.snapshot().activeReservations).toBe(1);
  });

  it("finds and releases an orphan reservation after reserve commit and restart cancellation", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-orphan-reserve-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    const gateway = { reserve: (input: Parameters<TokenGateway["reserve"]>[0]) => { realGateway.reserve(input); throw new Error("after_reserve"); }, release: realGateway.release.bind(realGateway), settle: realGateway.settle.bind(realGateway) };
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "orphan reserve", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => first.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_reserve");
    const restartedGateway = new TokenGateway({ stateDir });
    const restarted = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: restartedGateway, supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(restarted.cancelRun(draft.current.run_id).status).toBe("cancelled");
    expect(restartedGateway.snapshot().activeReservations).toBe(0);
  });

  it("cancels a task when enqueue committed before an injected throw", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-enqueue-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const supervisor = new SupervisorQueue({ stateDir });
    const throwingSupervisor = {
      enqueue: (input: Parameters<SupervisorQueue["enqueue"]>[0]) => { supervisor.enqueue(input); throw new Error("after_enqueue"); },
      peekClaimable: supervisor.peekClaimable.bind(supervisor), claim: supervisor.claim.bind(supervisor), complete: supervisor.complete.bind(supervisor), fail: supervisor.fail.bind(supervisor),
      cancel: supervisor.cancel.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor)
    };
    const gateway = new TokenGateway({ stateDir });
    const orchestrator = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor: throwingSupervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = orchestrator.prepareRun({ project_id: "alpha", prompt: "enqueue once", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => orchestrator.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_enqueue");
    expect(supervisor.snapshot()[0]?.status).toBe("cancelled");
    expect(gateway.snapshot().activeReservations).toBe(0);
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ status: "approved", supervisor_task_id: null });
  });

  it("finishes cancellation after release committed before an injected throw", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-cancel-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    const supervisor = new SupervisorQueue({ stateDir });
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: realGateway, supervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "cancel fault", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const throwingGateway = { reserve: realGateway.reserve.bind(realGateway), settle: realGateway.settle.bind(realGateway), release: (reservation: Parameters<TokenGateway["release"]>[0]) => { realGateway.release(reservation); throw new Error("after_release"); } };
    const faulty = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: throwingGateway, supervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(() => faulty.cancelRun(draft.current.run_id)).toThrow("after_release");
    const recovered = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(recovered.cancelRun(draft.current.run_id).status).toBe("cancelled");
    expect(new TokenGateway({ stateDir }).snapshot().activeReservations).toBe(0);
  });

  it("reconciles when durable bind commits before an injected throw", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-bind-commit-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    let fault = true;
    const gateway = new TokenGateway({ stateDir });
    const supervisor = new SupervisorQueue({ stateDir });
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true, afterPhase: (phase) => { if (phase === "bound" && fault) { fault = false; throw new Error("after_bind_commit"); } } });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "bind fault", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => first.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_bind_commit");
    const restarted = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(restarted.approveAndQueueRun(draft.current.run_id, 1, "owner").status).toBe("queued");
    expect(new TokenGateway({ stateDir }).snapshot().activeReservations).toBe(1);
  });

  it("treats queued transition commit-then-throw as queued without compensating", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-queue-commit-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    let fault = true;
    const supervisor = new SupervisorQueue({ stateDir });
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true, afterPhase: (phase) => { if (phase === "queued" && fault) { fault = false; throw new Error("after_queue_commit"); } } });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "queue fault", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => first.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_queue_commit");
    expect(readRunStore(stateDir).runs[0]?.status).toBe("queued");
    expect(supervisor.snapshot()[0]?.status).toBe("queued");
    const restarted = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(restarted.approveAndQueueRun(draft.current.run_id, 1, "owner").status).toBe("queued");
  });

  it("persists cancellation intent and releases even when supervisor cancellation throws", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-cancel-throw-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const gateway = new TokenGateway({ stateDir });
    const supervisor = new SupervisorQueue({ stateDir });
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "cancel throw", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    const throwingSupervisor = { enqueue: supervisor.enqueue.bind(supervisor), peekClaimable: supervisor.peekClaimable.bind(supervisor), claim: supervisor.claim.bind(supervisor), complete: supervisor.complete.bind(supervisor), fail: supervisor.fail.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor), cancel: vi.fn(() => { throw new Error("cancel_failed"); }) };
    const faulty = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor: throwingSupervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(() => faulty.cancelRun(draft.current.run_id)).toThrow("cancel_failed");
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ cancellation_requested: true, reservation_status: "released" });
    const recovered = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(recovered.cancelRun(draft.current.run_id).status).toBe("cancelled");
  });

  it("replays success after the settled marker commits and bounds oversized output", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-post-mark-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    let fault = true;
    const output = "x".repeat(40_000);
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-large", handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5", exitCode: 0, rawOutput: output, parsedJson: null, durationSeconds: 1, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true, afterPhase: (phase) => { if (phase === "reservation_terminal" && fault) { fault = false; throw new Error("after_terminal_mark"); } } });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "large", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    await expect(first.runSupervisorOnce()).rejects.toThrow("after_terminal_mark");
    const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    expect((await second.runSupervisorOnce())?.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readRunStore(stateDir).runs[0]?.provider_result?.raw_output).toHaveLength(32_000);
  });

  it("replays refusal after release marker and supervisor cancel commit faults", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-refusal-replay-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const supervisor = new SupervisorQueue({ stateDir });
    const dispatch = vi.fn(async () => ({ refused: true as const, reason: "routing_no_viable_provider" as const, tier_id: null, provenance_verified: true }));
    let fault = true;
    const throwingSupervisor = { enqueue: supervisor.enqueue.bind(supervisor), peekClaimable: supervisor.peekClaimable.bind(supervisor), claim: supervisor.claim.bind(supervisor), complete: supervisor.complete.bind(supervisor), fail: supervisor.fail.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor), cancel: (taskId: string, reason?: string, at?: string) => { const value = supervisor.cancel(taskId, reason, at); if (fault) { fault = false; throw new Error("after_cancel_commit"); } return value; } };
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: throwingSupervisor, dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "refuse", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    await expect(first.runSupervisorOnce()).rejects.toThrow("after_cancel_commit");
    const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    expect((await second.runSupervisorOnce())?.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("replays enqueue compensation after release commits then throws", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-comp-release-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    let releaseFault = true;
    const gateway = { reserve: realGateway.reserve.bind(realGateway), settle: realGateway.settle.bind(realGateway), release: (reservation: Parameters<TokenGateway["release"]>[0]) => { realGateway.release(reservation); if (releaseFault) { releaseFault = false; throw new Error("after_release_commit"); } }, findActiveReservation: realGateway.findActiveReservation.bind(realGateway) };
    const supervisor = new SupervisorQueue({ stateDir });
    let enqueueFault = true;
    const throwingSupervisor = { peekClaimable: supervisor.peekClaimable.bind(supervisor), claim: supervisor.claim.bind(supervisor), complete: supervisor.complete.bind(supervisor), fail: supervisor.fail.bind(supervisor), cancel: supervisor.cancel.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor), enqueue: (input: Parameters<SupervisorQueue["enqueue"]>[0]) => { const value = supervisor.enqueue(input); if (enqueueFault) { enqueueFault = false; throw new Error("after_enqueue_commit"); } return value; } };
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor: throwingSupervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "compensate", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => first.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_enqueue_commit");
    expect(readRunStore(stateDir).runs[0]?.queue_compensation_requested).toBe(true);
    const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(second.approveAndQueueRun(draft.current.run_id, 1, "owner").status).toBe("queued");
    expect(new SupervisorQueue({ stateDir }).snapshot().filter((task) => task.status === "queued")).toHaveLength(1);
  });

  it("recovers when compensation clear commits before throwing", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-comp-clear-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const supervisor = new SupervisorQueue({ stateDir });
    let enqueueFault = true;
    const throwingSupervisor = { peekClaimable: supervisor.peekClaimable.bind(supervisor), claim: supervisor.claim.bind(supervisor), complete: supervisor.complete.bind(supervisor), fail: supervisor.fail.bind(supervisor), cancel: supervisor.cancel.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor), enqueue: (input: Parameters<SupervisorQueue["enqueue"]>[0]) => { const value = supervisor.enqueue(input); if (enqueueFault) { enqueueFault = false; throw new Error("after_enqueue_commit"); } return value; } };
    let clearFault = true;
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: throwingSupervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true, afterPhase: (phase) => { if (phase === "compensation_cleared" && clearFault) { clearFault = false; throw new Error("after_clear_commit"); } } });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "clear", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => first.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("after_enqueue_commit");
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ queue_compensation_requested: false, supervisor_task_id: null, reservation_status: "none" });
    const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(second.approveAndQueueRun(draft.current.run_id, 1, "owner").status).toBe("queued");
  });

  for (const phase of ["artifact", "finalized"] as const) {
    it(`does not redispatch when ${phase} persistence commits before throwing`, async () => {
      const stateDir = mkdtempSync(join(tmpdir(), `run-orchestrator-${phase}-fault-`));
      writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
      let fault = true;
      const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: `worker-${phase}`, handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5", exitCode: 0, rawOutput: "done", parsedJson: null, durationSeconds: 1, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
      const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true, afterPhase: (current) => { if (current === phase && fault) { fault = false; throw new Error(`after_${phase}`); } } });
      const draft = first.prepareRun({ project_id: "alpha", prompt: phase, provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
      first.approveAndQueueRun(draft.current.run_id, 1, "owner");
      await expect(first.runSupervisorOnce()).rejects.toThrow(`after_${phase}`);
      const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
      await second.runSupervisorOnce();
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(readRunStore(stateDir).runs[0]?.status).toBe("completed");
    });
  }

  it("does not redispatch when supervisor completion commits before throwing", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-complete-fault-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const supervisor = new SupervisorQueue({ stateDir });
    let fault = true;
    const throwingSupervisor = { enqueue: supervisor.enqueue.bind(supervisor), peekClaimable: supervisor.peekClaimable.bind(supervisor), claim: supervisor.claim.bind(supervisor), fail: supervisor.fail.bind(supervisor), cancel: supervisor.cancel.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor), complete: (taskId: string, at?: string) => { const value = supervisor.complete(taskId, at); if (fault) { fault = false; throw new Error("after_complete_commit"); } return value; } };
    const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-complete", handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5", exitCode: 0, rawOutput: "done", parsedJson: null, durationSeconds: 1, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: throwingSupervisor, dispatch, now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "complete", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    first.approveAndQueueRun(draft.current.run_id, 1, "owner");
    await expect(first.runSupervisorOnce()).rejects.toThrow("after_complete_commit");
    const second = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, now: () => now, isRouteAvailable: () => true });
    expect((await second.runSupervisorOnce())?.status).toBe("completed");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("replays no-task enqueue compensation when release commits before throwing", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-no-task-release-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const realGateway = new TokenGateway({ stateDir });
    let releaseFault = true;
    const gateway = { reserve: realGateway.reserve.bind(realGateway), settle: realGateway.settle.bind(realGateway), findActiveReservation: realGateway.findActiveReservation.bind(realGateway), release: (reservation: Parameters<TokenGateway["release"]>[0]) => { realGateway.release(reservation); if (releaseFault) { releaseFault = false; throw new Error("after_release_commit"); } } };
    const supervisor = new SupervisorQueue({ stateDir });
    const noTaskSupervisor = { peekClaimable: supervisor.peekClaimable.bind(supervisor), claim: supervisor.claim.bind(supervisor), complete: supervisor.complete.bind(supervisor), fail: supervisor.fail.bind(supervisor), cancel: supervisor.cancel.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor), enqueue: () => { throw new Error("enqueue_before_commit"); } };
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor: noTaskSupervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "no task", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => first.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("enqueue_before_commit");
    expect(readRunStore(stateDir).runs[0]?.queue_compensation_requested).toBe(true);
    const restarted = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(restarted.approveAndQueueRun(draft.current.run_id, 1, "owner").status).toBe("queued");
    expect(new TokenGateway({ stateDir }).snapshot().activeReservations).toBe(1);
  });

  it("replays no-task enqueue compensation when clear commits before throwing", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-no-task-clear-"));
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
    const supervisor = new SupervisorQueue({ stateDir });
    const noTaskSupervisor = { peekClaimable: supervisor.peekClaimable.bind(supervisor), claim: supervisor.claim.bind(supervisor), complete: supervisor.complete.bind(supervisor), fail: supervisor.fail.bind(supervisor), cancel: supervisor.cancel.bind(supervisor), snapshot: supervisor.snapshot.bind(supervisor), enqueue: () => { throw new Error("enqueue_before_commit"); } };
    let clearFault = true;
    const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: noTaskSupervisor, dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true, afterPhase: (phase) => { if (phase === "compensation_cleared" && clearFault) { clearFault = false; throw new Error("after_clear_commit"); } } });
    const draft = first.prepareRun({ project_id: "alpha", prompt: "no task clear", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
    expect(() => first.approveAndQueueRun(draft.current.run_id, 1, "owner")).toThrow("enqueue_before_commit");
    expect(readRunStore(stateDir).runs[0]).toMatchObject({ queue_compensation_requested: false, supervisor_task_id: null, reservation_status: "none" });
    const restarted = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch: vi.fn(), now: () => now, isRouteAvailable: () => true });
    expect(restarted.approveAndQueueRun(draft.current.run_id, 1, "owner").status).toBe("queued");
  });

  for (const phase of ["release", "reservation_terminal", "finalized"] as const) {
    it(`replays terminal dispatch failure after ${phase} commit fault`, async () => {
      const stateDir = mkdtempSync(join(tmpdir(), `run-orchestrator-failure-${phase}-`));
      writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: fixtureProjectCwd, enabled: true }] });
      const realGateway = new TokenGateway({ stateDir });
      let releaseFault = phase === "release";
      const gateway = { reserve: realGateway.reserve.bind(realGateway), settle: realGateway.settle.bind(realGateway), findActiveReservation: realGateway.findActiveReservation.bind(realGateway), acknowledgeTerminal: realGateway.acknowledgeTerminal.bind(realGateway), release: (reservation: Parameters<TokenGateway["release"]>[0]) => { realGateway.release(reservation); if (releaseFault) { releaseFault = false; throw new Error("after_failure_release"); } } };
      let phaseFault = true;
      const faultPhase: "reservation_terminal" | "finalized" | null = phase === "release" ? null : phase;
      const dispatch = vi.fn(async () => { throw new Error("provider_crash"); });
      const first = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: gateway, supervisor: new SupervisorQueue({ stateDir }), dispatch, supervisorMaxAttempts: 1, now: () => now, isRouteAvailable: () => true, afterPhase: (current) => { if (faultPhase !== null && current === faultPhase && phaseFault) { phaseFault = false; throw new Error(`after_failure_${phase}`); } } });
      const draft = first.prepareRun({ project_id: "alpha", prompt: "fail", provider: "codex_cli", model: "gpt-5", estimated_tokens: 20_000, requested_artifacts: ["text"] });
      first.approveAndQueueRun(draft.current.run_id, 1, "owner");
      await expect(first.runSupervisorOnce()).rejects.toThrow();
      const restarted = createRunOrchestrator({ stateDir, projectRoot: fixtureProjectRoot, tokenGateway: new TokenGateway({ stateDir }), supervisor: new SupervisorQueue({ stateDir }), dispatch, supervisorMaxAttempts: 1, now: () => now, isRouteAvailable: () => true });
      await restarted.runSupervisorOnce();
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(readRunStore(stateDir).runs[0]).toMatchObject({ status: "failed", terminal_reason: "provider_crash", reservation_status: "released" });
    });
  }
});
