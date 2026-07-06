import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeHandoffId } from "../../src/data/delivery-system/checkCompletionMatrix";
import type { CliWorkerResult } from "../../src/data/delivery-system/cliWorker";
import {
  resolveRoutingLane,
  type RoutingModeId
} from "../../src/data/delivery-system/routingModes";
import { buildAgentPacket, loadDecisionMeshFromRoot } from "../../src/lib/decision-mesh";
import {
  computePacketHash,
  dispatchHandoff,
  type GovernedHandoff
} from "../../src/governed-core";

const mocks = vi.hoisted(() => ({
  runCliWorker: vi.fn()
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

const task = "bounded implementation security audit vendor chokepoint dispatch";
const agent = "security";
const mesh = loadDecisionMeshFromRoot(process.cwd());
const packet = buildAgentPacket(mesh, { task, agent, token_budget: 8000 });

describe("resolveRoutingLane", () => {
  it("maps concrete dispatch targets to routing lanes", () => {
    expect(resolveRoutingLane({ vendor: "codex_cli" })).toBe("codex_cli");
    expect(resolveRoutingLane({ vendor: "agy_cli" })).toBe("agy_fast");
    expect(resolveRoutingLane({ vendor: "agy_cli", model: "agy-pro" })).toBe("agy_deep");
    expect(resolveRoutingLane({ vendor: "openrouter_api", openrouterMode: "nemotron_planning" })).toBe(
      "openrouter_nemotron_planning"
    );
    expect(resolveRoutingLane({ vendor: "openrouter_api", openrouterMode: "qwen3_code_draft" })).toBe(
      "openrouter_qwen3_code_draft"
    );
    expect(() => resolveRoutingLane({ vendor: "openrouter_api" })).toThrow(
      "routing_lane_unresolved: openrouter_api handoff requires an openrouterMode"
    );
  });
});

describe("dispatchHandoff routing_mode lane guard", () => {
  beforeEach(() => {
    mocks.runCliWorker.mockReset();
  });

  it("refuses codex_cli in idea mode without spawning", async () => {
    const result = await dispatchHandoff(
      baseHandoff({ vendor: "codex_cli", routing_mode: "idea" }),
      refusalStateDir
    );

    expect(result).toEqual({
      refused: true,
      reason: "lane_not_allowed_in_mode",
      tier_id: null,
      provenance_verified: true
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();
  });

  it("refuses qwen3 OpenRouter drafting in idea mode without spawning", async () => {
    const result = await dispatchHandoff(
      baseHandoff({
        vendor: "openrouter_api",
        openrouterMode: "qwen3_code_draft",
        routing_mode: "idea"
      }),
      refusalStateDir
    );

    expect(result).toEqual({
      refused: true,
      reason: "lane_not_allowed_in_mode",
      tier_id: null,
      provenance_verified: true
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();
  });

  it("allows agy_cli in idea mode past the lane guard", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-routing-mode-"));
    mocks.runCliWorker.mockResolvedValue(fakeCliWorkerResult("agy_cli"));

    const result = await dispatchHandoff(baseHandoff({ vendor: "agy_cli", routing_mode: "idea" }), stateDir);

    if (result.refused) {
      expect(result.reason).not.toBe("lane_not_allowed_in_mode");
    } else {
      expect(result.refused).toBe(false);
    }
    expect(mocks.runCliWorker).toHaveBeenCalledTimes(1);
  });

  it("allows Nemotron planning in idea mode past the lane guard", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-routing-mode-"));
    mocks.runCliWorker.mockResolvedValue(fakeCliWorkerResult("openrouter_api"));

    const result = await dispatchHandoff(
      baseHandoff({
        vendor: "openrouter_api",
        openrouterMode: "nemotron_planning",
        taskPacketRef: "packet-hp-20260630-governed-dispatch",
        routing_mode: "idea"
      }),
      stateDir
    );

    if (result.refused) {
      expect(result.reason).not.toBe("lane_not_allowed_in_mode");
    } else {
      expect(result.refused).toBe(false);
    }
    expect(mocks.runCliWorker).toHaveBeenCalledTimes(1);
    expect(mocks.runCliWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: "openrouter_api",
        openrouterMode: "nemotron_planning",
        taskPacketRef: "packet-hp-20260630-governed-dispatch",
        routingMode: "idea",
        lockSource: "governed_dispatch_verified"
      }),
      stateDir
    );
  });
});

describe("computePacketHash routing_mode binding", () => {
  it("binds the routing mode into the packet hash", () => {
    const ideaHash = computePacketHash(packet, "idea");
    const buildHash = computePacketHash(packet, "build");

    expect(ideaHash).not.toBe(buildHash);
    expect(computePacketHash(packet)).not.toBe(ideaHash);
    expect(computePacketHash(packet, "idea")).toBe(ideaHash);
  });
});

function baseHandoff(overrides: Partial<GovernedHandoff> = {}): GovernedHandoff {
  return {
    handoffId: makeHandoffId("hp-20260630-governed-dispatch"),
    vendor: "agy_cli",
    prompt: "Implement only the governed dispatch boundary.",
    parentSessionHash: "parent-session-hash",
    parentTurnHash: "parent-turn-hash",
    task,
    agent,
    packet_hash: packetHash(overrides.routing_mode),
    required_checks: ["dispatch_test_gate"],
    ...overrides
  };
}

function packetHash(routingMode?: RoutingModeId): string {
  return computePacketHash(packet, routingMode);
}

function fakeCliWorkerResult(vendor: GovernedHandoff["vendor"]): CliWorkerResult {
  return {
    workerRunId: "cli-hp-20260630-governed-dispatch-routing-mode-20260630T120000",
    handoffId: makeHandoffId("hp-20260630-governed-dispatch"),
    vendor,
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
