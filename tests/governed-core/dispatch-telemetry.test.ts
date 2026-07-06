import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeHandoffId } from "../../src/data/delivery-system/checkCompletionMatrix";
import { buildAgentPacket, loadDecisionMeshFromRoot } from "../../src/lib/decision-mesh";
import {
  buildDispatchDecisionRecord,
  computePacketHash,
  dispatchHandoff,
  type GovernedHandoff
} from "../../src/governed-core/dispatch";

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

const task = "bounded implementation security audit vendor chokepoint dispatch";
const agent = "security";
const mesh = loadDecisionMeshFromRoot(process.cwd());
const packet = buildAgentPacket(mesh, { task, agent, token_budget: 8000 });

describe("dispatch decision telemetry", () => {
  beforeEach(() => {
    mocks.runCliWorker.mockReset();
  });

  it("builds a pure redacted record with only the task hash", () => {
    const distinctiveTask = "DISTINCTIVE_RAW_TASK_STRING_MUST_NOT_APPEAR";
    const record = buildDispatchDecisionRecord({
      recordedAt: "2026-07-06T12:00:00.000Z",
      handoff: baseHandoff({ task: distinctiveTask }),
      tierId: "codex_subscription",
      decision: "refused",
      refusalReason: "lane_not_allowed_in_mode"
    });

    expect(record.task_hash).toBe(
      createHash("sha256").update(distinctiveTask, "utf8").digest("hex")
    );
    expect(JSON.stringify(record)).not.toContain(distinctiveTask);
  });

  it("writes one redacted refused dispatch decision for a lane_not_allowed_in_mode refusal", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "governed-dispatch-decision-"));

    const result = await dispatchHandoff(
      baseHandoff({ vendor: "codex_cli", routing_mode: "idea" }),
      stateDir
    );

    expect(result).toEqual({
      refused: true,
      reason: "lane_not_allowed_in_mode",
      tier_id: null,
      provenance_verified: true
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();

    const lines = readFileSync(join(stateDir, "dispatch-decisions.jsonl"), "utf8").trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record).toMatchObject({
      schema_version: "v1",
      handoff_id: "hp-20260630-governed-dispatch",
      agent,
      vendor: "codex_cli",
      routing_mode: "idea",
      resolved_lane: "codex_cli",
      tier_id: null,
      decision: "refused",
      refusal_reason: "lane_not_allowed_in_mode"
    });
    expect(record.task_hash).toBe(createHash("sha256").update(task, "utf8").digest("hex"));
    expect(JSON.stringify(record)).not.toContain(task);
  });

  it("keeps the dispatch result when telemetry cannot be written", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "governed-dispatch-unwritable-"));
    const fileStateDir = join(stateRoot, "not-a-directory");
    writeFileSync(fileStateDir, "not a directory", "utf8");

    await expect(dispatchHandoff(
      baseHandoff({ vendor: "codex_cli", routing_mode: "idea" }),
      fileStateDir
    )).resolves.toEqual({
      refused: true,
      reason: "lane_not_allowed_in_mode",
      tier_id: null,
      provenance_verified: true
    });
    expect(mocks.runCliWorker).not.toHaveBeenCalled();
  });
});

function baseHandoff(overrides: Partial<GovernedHandoff> = {}): GovernedHandoff {
  const routingMode = overrides.routing_mode;

  return {
    handoffId: makeHandoffId("hp-20260630-governed-dispatch"),
    vendor: "agy_cli",
    prompt: "Implement only the governed dispatch boundary.",
    parentSessionHash: "parent-session-hash",
    parentTurnHash: "parent-turn-hash",
    task,
    agent,
    packet_hash: computePacketHash(packet, routingMode),
    required_checks: ["dispatch_test_gate"],
    ...overrides
  };
}
