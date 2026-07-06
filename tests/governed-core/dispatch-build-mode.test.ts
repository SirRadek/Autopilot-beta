import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeHandoffId } from "../../src/data/delivery-system/checkCompletionMatrix";
import type { CliWorkerResult } from "../../src/data/delivery-system/cliWorker";
import { DISPATCH_DECISION_TELEMETRY_PATH } from "../../src/data/delivery-system/sessionState";
import {
  isBuildPrepProvenanceSatisfied,
  type BuildPrepProvenance,
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

vi.mock("../../src/data/delivery-system/cliWorker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/data/delivery-system/cliWorker")>();
  return {
    ...actual,
    runCliWorker: mocks.runCliWorker
  };
});

const task = "bounded build upstream draft precondition dispatch";
const agent = "implementation";
const mesh = loadDecisionMeshFromRoot(process.cwd());
const packet = buildAgentPacket(mesh, { task, agent, token_budget: 8000 });

describe("isBuildPrepProvenanceSatisfied", () => {
  it("accepts non-empty cheap attempt trails", () => {
    expect(
      isBuildPrepProvenanceSatisfied({
        kind: "cheap_attempts",
        cheap_attempt_refs: ["worker-run-1"]
      })
    ).toBe(true);
  });

  it("rejects absent or empty cheap attempt trails", () => {
    expect(isBuildPrepProvenanceSatisfied(undefined)).toBe(false);
    expect(isBuildPrepProvenanceSatisfied({ kind: "cheap_attempts", cheap_attempt_refs: [] })).toBe(false);
    expect(
      isBuildPrepProvenanceSatisfied({
        kind: "cheap_attempts",
        cheap_attempt_refs: ["worker-run-1", ""]
      })
    ).toBe(false);
    expect(
      isBuildPrepProvenanceSatisfied({
        kind: "cheap_attempts",
        cheap_attempt_refs: ["   "]
      })
    ).toBe(false);
  });

  it("accepts cheap_not_applicable only with reason and owner override", () => {
    expect(
      isBuildPrepProvenanceSatisfied({
        kind: "cheap_not_applicable",
        reason: "No cheap lane can apply to this artifact shape.",
        owner_override: true
      })
    ).toBe(true);

    expect(
      isBuildPrepProvenanceSatisfied({
        kind: "cheap_not_applicable",
        reason: "",
        owner_override: true
      })
    ).toBe(false);
    expect(
      isBuildPrepProvenanceSatisfied({
        kind: "cheap_not_applicable",
        reason: "owner accepted no cheap lane"
      } as unknown as BuildPrepProvenance)
    ).toBe(false);
  });
});

describe("dispatchHandoff build-mode upstream draft gate", () => {
  beforeEach(() => {
    mocks.runCliWorker.mockReset();
  });

  it("refuses build codex_cli without upstream draft provenance and records the decision", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-build-mode-"));

    const result = await dispatchHandoff(baseHandoff({ vendor: "codex_cli" }), stateDir);

    expect(result).toEqual({
      refused: true,
      reason: "missing_upstream_draft",
      tier_id: null,
      provenance_verified: true
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();

    const record = readLastDispatchDecision(stateDir);
    expect(record.refusal_reason).toBe("missing_upstream_draft");
    expect(record.routing_mode).toBe("build");
  });

  it("allows build codex_cli with task packet, task package hash, and cheap attempt provenance", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-build-mode-"));
    mocks.runCliWorker.mockResolvedValue(fakeCliWorkerResult("codex_cli"));

    const result = await dispatchHandoff(
      baseHandoff({
        vendor: "codex_cli",
        taskPacketRef: "packet-hp-20260706-build-mode",
        task_package_hash: "task-package-hash",
        prep_provenance: {
          kind: "cheap_attempts",
          cheap_attempt_refs: ["worker-run-cheap-draft-1"]
        }
      }),
      stateDir
    );

    expect(result.refused).toBe(false);
    expect(mocks.runCliWorker).toHaveBeenCalledTimes(1);
  });

  it("allows build codex_cli with owner-approved cheap_not_applicable provenance", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-build-mode-"));
    mocks.runCliWorker.mockResolvedValue(fakeCliWorkerResult("codex_cli"));

    const result = await dispatchHandoff(
      baseHandoff({
        vendor: "codex_cli",
        taskPacketRef: "packet-hp-20260706-build-mode",
        task_package_hash: "task-package-hash",
        prep_provenance: {
          kind: "cheap_not_applicable",
          reason: "No cheap lane can apply to this constrained owner-approved patch.",
          owner_override: true
        }
      }),
      stateDir
    );

    expect(result.refused).toBe(false);
    expect(mocks.runCliWorker).toHaveBeenCalledTimes(1);
  });

  it("does not require upstream draft provenance for build cheap lanes", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-build-mode-"));
    mocks.runCliWorker.mockResolvedValue(fakeCliWorkerResult("openrouter_api"));

    const result = await dispatchHandoff(
      baseHandoff({
        vendor: "openrouter_api",
        openrouterMode: "qwen3_code_draft"
      }),
      stateDir
    );

    if (result.refused) {
      expect(result.reason).not.toBe("missing_upstream_draft");
    } else {
      expect(result.refused).toBe(false);
    }
    expect(mocks.runCliWorker).toHaveBeenCalledTimes(1);
  });

  it("does not apply the upstream draft gate to idea-mode agy handoffs", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-build-mode-"));
    mocks.runCliWorker.mockResolvedValue(fakeCliWorkerResult("agy_cli"));

    const result = await dispatchHandoff(
      baseHandoff({
        vendor: "agy_cli",
        routing_mode: "idea"
      }),
      stateDir
    );

    if (result.refused) {
      expect(result.reason).not.toBe("missing_upstream_draft");
    } else {
      expect(result.refused).toBe(false);
    }
    expect(mocks.runCliWorker).toHaveBeenCalledTimes(1);
  });
});

function baseHandoff(overrides: Partial<GovernedHandoff> = {}): GovernedHandoff {
  const routingMode = overrides.routing_mode ?? "build";

  return {
    handoffId: makeHandoffId("hp-20260706-build-mode"),
    vendor: "codex_cli",
    prompt: "Implement only the governed build-mode upstream draft gate.",
    parentSessionHash: "parent-session-hash",
    parentTurnHash: "parent-turn-hash",
    task,
    agent,
    packet_hash: packetHash(routingMode),
    required_checks: ["dispatch_test_gate"],
    routing_mode: routingMode,
    ...overrides
  };
}

function packetHash(routingMode: RoutingModeId): string {
  return computePacketHash(packet, routingMode);
}

function readLastDispatchDecision(stateDir: string): Record<string, unknown> {
  const fileName = DISPATCH_DECISION_TELEMETRY_PATH.split(/[\\/]/).at(-1) ?? "dispatch-decisions.jsonl";
  const lines = readFileSync(join(stateDir, fileName), "utf8").trim().split(/\r?\n/);
  const lastLine = lines.at(-1);
  if (lastLine === undefined) {
    throw new Error("dispatch decision record missing");
  }
  return JSON.parse(lastLine) as Record<string, unknown>;
}

function fakeCliWorkerResult(vendor: GovernedHandoff["vendor"]): CliWorkerResult {
  return {
    workerRunId: "cli-hp-20260706-build-mode-20260706T120000",
    handoffId: makeHandoffId("hp-20260706-build-mode"),
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
