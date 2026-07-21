import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { writeProjectRegistry } from "../../src/data/delivery-system/projectRegistry";
import { createRunOrchestrator } from "../../src/data/delivery-system/runOrchestrator";
import { readRunStore } from "../../src/data/delivery-system/runStore";
import { SupervisorQueue } from "../../src/data/delivery-system/supervisorQueue";
import { TokenGateway } from "../../src/data/delivery-system/tokenGateway";

const now = "2026-07-21T10:00:00.000Z";

function harness() {
  const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-profile-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "run-orchestrator-profile-projects-"));
  const projectCwd = join(projectRoot, "alpha");
  mkdirSync(projectCwd, { recursive: true });
  writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: projectCwd, enabled: true }] });
  const dispatch = vi.fn(async () => ({ refused: false as const, workerRunId: "worker-1", handoffId: "handoff" as never, vendor: "codex_cli" as const, model: "gpt-5.5", exitCode: 0, rawOutput: "{}", parsedJson: null, durationSeconds: 0, lockStatus: "acquired_supervisor_spawn" as const, workerOutputPath: null, errorReason: null, tier_id: null, provenance_verified: true as const }));
  const orchestrator = createRunOrchestrator({
    stateDir,
    projectRoot,
    tokenGateway: { reserve: vi.fn(), release: vi.fn(), settle: vi.fn() } as never,
    supervisor: { enqueue: vi.fn(), peekClaimable: () => null, claim: () => null, complete: vi.fn(), fail: () => ({}), cancel: vi.fn() } as never,
    dispatch,
    now: () => now,
    isRouteAvailable: () => true
  });
  return { orchestrator, dispatch, stateDir };
}

describe("runOrchestrator profile", () => {
  it("classifies a prod run handoff as high risk and forwards the immutable owner selection", () => {
    const { orchestrator } = harness();
    const run = orchestrator.prepareRun({
      project_id: "alpha",
      prompt: "Publish",
      provider: "codex_cli",
      model: "gpt-5.5",
      requested_reasoning_effort: "xhigh",
      estimated_tokens: 20_000,
      requested_artifacts: ["text"],
      profile: "prod",
      promotion_packet_id: "packet-1"
    });
    const handoff = orchestrator.handoffForRun(run.current.run_id);
    expect(handoff.efficiency?.work_unit).toEqual({ work_unit_id: run.current.run_id, class: "high_risk", risk: "high" });
    expect(handoff.model).toBe("gpt-5.5");
    expect(handoff.generationSettings?.reasoning_effort).toBe("xhigh");
    expect(handoff.efficiency?.actual_reasoning_effort).toBe("xhigh");
    expect(handoff.efficiency?.profile).toBe("prod");
  });

  it("keeps a dev run ordinary and leaves the recommendation null", () => {
    const { orchestrator } = harness();
    const run = orchestrator.prepareRun({
      project_id: "alpha",
      prompt: "Iterate",
      provider: "codex_cli",
      model: null,
      requested_reasoning_effort: null,
      estimated_tokens: 20_000,
      requested_artifacts: ["text"],
      profile: "dev"
    });
    const handoff = orchestrator.handoffForRun(run.current.run_id);
    expect(handoff.efficiency?.work_unit.risk).toBe("ordinary");
    expect(handoff.efficiency?.actual_reasoning_effort).toBeNull();
    expect(handoff.efficiency?.profile).toBe("dev");
    expect(handoff.generationSettings).toBeUndefined();
  });

  it("treats a legacy record (no profile field) as prod high-risk", () => {
    const { orchestrator, stateDir } = harness();
    const run = orchestrator.prepareRun({
      project_id: "alpha",
      prompt: "Legacy",
      provider: "codex_cli",
      model: "gpt-5",
      requested_reasoning_effort: null,
      estimated_tokens: 20_000,
      requested_artifacts: ["text"],
      profile: "dev"
    });
    const path = join(stateDir, "runs.json");
    const document = JSON.parse(readFileSync(path, "utf8")) as {
      runs: Array<{ current: Record<string, unknown>; revisions: Array<Record<string, unknown>> }>;
    };
    for (const draft of [document.runs[0]!.current, ...document.runs[0]!.revisions]) {
      delete draft.profile;
      delete draft.requested_reasoning_effort;
      delete draft.promotion_packet_id;
    }
    writeFileSync(path, JSON.stringify(document, null, 2));

    const handoff = orchestrator.handoffForRun(run.current.run_id);
    expect(handoff.efficiency?.work_unit).toEqual({ work_unit_id: run.current.run_id, class: "high_risk", risk: "high" });
    expect(handoff.efficiency?.actual_reasoning_effort).toBeNull();
    expect(handoff.efficiency?.profile).toBe("legacy");
  });

  it("keeps the exact provider/model/reasoning route identical across a retry dispatch", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-profile-retry-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "run-orchestrator-profile-retry-projects-"));
    const projectCwd = join(projectRoot, "alpha");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: projectCwd, enabled: true }] });
    const dispatch = vi.fn()
      .mockResolvedValueOnce({ refused: false, workerRunId: "worker-failed", rawOutput: "failed output", exitCode: 1, errorReason: "retryable", lockStatus: "acquired_supervisor_spawn", model: "gpt-5.5" })
      .mockResolvedValueOnce({ refused: false, workerRunId: "worker-ok", rawOutput: "success", exitCode: 0, errorReason: null, lockStatus: "acquired_supervisor_spawn", model: "gpt-5.5" });
    const tokenGateway = new TokenGateway({ stateDir });
    const supervisor = new SupervisorQueue({ stateDir, baseRetryDelayMs: 0, maxRetryDelayMs: 0 });
    const orchestrator = createRunOrchestrator({ stateDir, projectRoot, tokenGateway, supervisor, dispatch: dispatch as never, now: () => now, isRouteAvailable: () => true });
    const draft = orchestrator.prepareRun({
      project_id: "alpha",
      prompt: "retry me",
      provider: "codex_cli",
      model: "gpt-5.5",
      requested_reasoning_effort: "high",
      estimated_tokens: 20_000,
      requested_artifacts: ["text"],
      profile: "prod",
      promotion_packet_id: "packet-2"
    });
    orchestrator.approveAndQueueRun(draft.current.run_id, draft.current.revision, "owner");
    expect(await orchestrator.runSupervisorOnce()).toBeNull();
    await orchestrator.runSupervisorOnce();
    expect(dispatch).toHaveBeenCalledTimes(2);
    const [firstCall] = dispatch.mock.calls[0]!;
    const [secondCall] = dispatch.mock.calls[1]!;
    expect(firstCall).toEqual(secondCall);
    expect(secondCall).toMatchObject({ vendor: "codex_cli", model: "gpt-5.5", generationSettings: { reasoning_effort: "high" } });
  });

  it("refuses a tampered retry route before claim, dispatch, or run-state mutation", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "run-orchestrator-profile-tamper-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "run-orchestrator-profile-tamper-projects-"));
    const projectCwd = join(projectRoot, "alpha");
    mkdirSync(projectCwd, { recursive: true });
    writeProjectRegistry(stateDir, { schema_version: "v1", projects: [{ schema_version: "v1", project_id: "alpha", name: "Alpha", cwd: projectCwd, enabled: true }] });
    const realSupervisor = new SupervisorQueue({ stateDir });
    const claim = vi.fn(realSupervisor.claim.bind(realSupervisor));
    const supervisor = {
      enqueue: realSupervisor.enqueue.bind(realSupervisor),
      peekClaimable: (at: string) => {
        const task = realSupervisor.peekClaimable(at);
        return task === null ? null : {
          ...task,
          handoff: { ...task.handoff, generationSettings: { reasoning_effort: "xhigh" } }
        };
      },
      claim,
      complete: realSupervisor.complete.bind(realSupervisor),
      fail: realSupervisor.fail.bind(realSupervisor),
      cancel: realSupervisor.cancel.bind(realSupervisor),
      snapshot: realSupervisor.snapshot.bind(realSupervisor)
    };
    const dispatch = vi.fn();
    const orchestrator = createRunOrchestrator({
      stateDir,
      projectRoot,
      tokenGateway: new TokenGateway({ stateDir }),
      supervisor,
      dispatch,
      now: () => now,
      isRouteAvailable: () => true
    });
    const draft = orchestrator.prepareRun({
      project_id: "alpha",
      prompt: "retry safely",
      provider: "codex_cli",
      model: "gpt-5.5",
      requested_reasoning_effort: "high",
      estimated_tokens: 20_000,
      requested_artifacts: ["text"],
      profile: "prod",
      promotion_packet_id: "packet-tamper"
    });
    orchestrator.approveAndQueueRun(draft.current.run_id, draft.current.revision, "owner");

    await expect(orchestrator.runSupervisorOnce()).rejects.toThrow("silent_route_change_forbidden");
    expect(claim).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(readRunStore(stateDir).runs[0]?.status).toBe("queued");
    expect(realSupervisor.snapshot()[0]?.status).toBe("queued");
  });
});
