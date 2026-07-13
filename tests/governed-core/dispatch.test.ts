import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeHandoffId } from "../../src/data/delivery-system/checkCompletionMatrix";
import type { CliWorkerResult } from "../../src/data/delivery-system/cliWorker";
import type { SupervisorRoutingDecision } from "../../src/data/delivery-system/modelPolicy";
import { buildAgentPacket, loadDecisionMeshFromRoot } from "../../src/lib/decision-mesh";
import {
  computePacketHash,
  dispatchHandoff,
  type GovernedHandoff
} from "../../src/governed-core";
import { TokenGateway } from "../../src/data/delivery-system/tokenGateway";

const mocks = vi.hoisted(() => ({
  runCliWorker: vi.fn(),
  buildSupervisorRoutingDecision: vi.fn()
}));

// Refusal paths now RECORD a dispatch-decision line (Phase 5.1), so even refusal tests need a real
// writable stateDir — a repo-relative literal would pollute the working tree on every run.
const refusalStateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-refusal-"));

vi.mock("../../src/data/delivery-system/cliWorker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/data/delivery-system/cliWorker")>();
  return {
    ...actual,
    runCliWorker: mocks.runCliWorker
  };
});

vi.mock("../../src/data/delivery-system/modelPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/data/delivery-system/modelPolicy")>();
  mocks.buildSupervisorRoutingDecision.mockImplementation(actual.buildSupervisorRoutingDecision);
  return {
    ...actual,
    buildSupervisorRoutingDecision: mocks.buildSupervisorRoutingDecision
  };
});

const task = "bounded implementation security audit vendor chokepoint dispatch";
const agent = "security";
const mesh = loadDecisionMeshFromRoot(process.cwd());
const packet = buildAgentPacket(mesh, { task, agent, token_budget: 8000 });
const packetHash = computePacketHash(packet);

describe("dispatchHandoff", () => {
  beforeEach(() => {
    mocks.runCliWorker.mockReset();
    mocks.buildSupervisorRoutingDecision.mockClear();
  });

  it("verifies packet provenance and required checks before spawning through the worker lane", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-"));
    mocks.runCliWorker.mockResolvedValue(fakeCliWorkerResult());

    const result = await dispatchHandoff(baseHandoff(), stateDir);

    expect(result.refused).toBe(false);
    expect(result.tier_id).toBeNull();
    expect(result.provenance_verified).toBe(true);
    expect(mocks.runCliWorker).toHaveBeenCalledTimes(1);
    expect(mocks.runCliWorker).toHaveBeenCalledWith(
      expect.objectContaining({ lockSource: "governed_dispatch_verified" }),
      stateDir
    );
  });

  it("refuses a forged packet hash without spawning", async () => {
    const result = await dispatchHandoff(baseHandoff({ packet_hash: "wrong-hash" }), refusalStateDir);

    expect(result).toEqual({
      refused: true,
      reason: "packet_provenance_mismatch",
      tier_id: null,
      provenance_verified: false
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();
  });

  it("refuses missing required checks without spawning", async () => {
    const result = await dispatchHandoff(baseHandoff({ required_checks: [] }), refusalStateDir);

    expect(result).toEqual({
      refused: true,
      reason: "missing_required_checks",
      tier_id: null,
      provenance_verified: true
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();
  });

  it("refuses a routing decision with no viable provider without spawning", async () => {
    mocks.buildSupervisorRoutingDecision.mockReturnValueOnce({
      assignedProvider: undefined,
      assignedTierId: undefined
    } as unknown as SupervisorRoutingDecision);

    const result = await dispatchHandoff(
      baseHandoff({
        routing: {
          layer: "bounded_coding",
          budgets: [],
          evalRecords: [],
          now: "2026-06-30T12:00:00.000Z"
        }
      }),
      refusalStateDir
    );

    expect(result).toEqual({
      refused: true,
      reason: "routing_no_viable_provider",
      tier_id: null,
      provenance_verified: true
    });
    expect(mocks.buildSupervisorRoutingDecision).toHaveBeenCalledWith({
      taskId: "hp-20260630-governed-dispatch",
      taskDescription: task,
      layer: "bounded_coding",
      budgets: [],
      evalRecords: [],
      now: "2026-06-30T12:00:00.000Z"
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();
  });

  it("reserves through the token gateway before dispatch and refuses exhausted caps", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-token-gateway-"));
    const gateway = new TokenGateway({ stateDir, limits: {
      inputCapTokens: 100,
      outputCapTokens: 100,
      providerBudgetTokens: 1_000,
      modelBudgetTokens: 1_000,
      sessionBudgetTokens: 1_000
    } });
    const result = await dispatchHandoff(baseHandoff(), stateDir, { tokenGateway: gateway });
    expect(result).toEqual({
      refused: true,
      reason: "token_budget_exhausted",
      tier_id: null,
      provenance_verified: true
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();
    expect(gateway.snapshot().activeReservations).toBe(0);
  });

  it("releases a reservation when the worker throws before returning a result", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-token-gateway-throw-"));
    const gateway = new TokenGateway({ stateDir, limits: {
      inputCapTokens: 100,
      outputCapTokens: 10_000,
      providerBudgetTokens: 10_000,
      modelBudgetTokens: 10_000,
      sessionBudgetTokens: 10_000
    } });
    mocks.runCliWorker.mockRejectedValueOnce(new Error("worker_failed"));
    await expect(dispatchHandoff(baseHandoff(), stateDir, { tokenGateway: gateway })).rejects.toThrow("worker_failed");
    expect(gateway.snapshot().activeReservations).toBe(0);
  });
});

function baseHandoff(overrides: Partial<GovernedHandoff> = {}): GovernedHandoff {
  return {
    handoffId: makeHandoffId("hp-20260630-governed-dispatch"),
    vendor: "codex_cli",
    prompt: "Implement only the governed dispatch boundary.",
    parentSessionHash: "parent-session-hash",
    parentTurnHash: "parent-turn-hash",
    task,
    agent,
    packet_hash: packetHash,
    required_checks: ["dispatch_test_gate"],
    ...overrides
  };
}

function fakeCliWorkerResult(): CliWorkerResult {
  return {
    workerRunId: "cli-codex-hp-20260630-governed-dispatch-20260630T120000",
    handoffId: makeHandoffId("hp-20260630-governed-dispatch"),
    vendor: "codex_cli",
    model: null,
    exitCode: 0,
    rawOutput: "ok",
    parsedJson: null,
    durationSeconds: 0.1,
    lockStatus: "acquired_supervisor_spawn",
    workerOutputPath: null,
    errorReason: null
  };
}
