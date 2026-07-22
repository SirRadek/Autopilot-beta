import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBrainstormTelemetryEvent,
  readBrainstormTelemetry,
  recordBrainstormTelemetryEvent,
} from "../../src/data/delivery-system/brainstormTelemetry";
import type { BrainstormRecord } from "../../src/data/delivery-system/brainstormStore";
import type { RunRecord } from "../../src/data/delivery-system/runStore";

const createdAt = "2026-07-22T10:00:00.000Z";
const at = "2026-07-22T10:00:02.500Z";

function brainstorm(): BrainstormRecord {
  return {
    schema_version: "v1",
    brainstorm_id: "brainstorm-safe-id",
    project_id: "private-project",
    brief: "private brief must never enter telemetry",
    routes: [
      { provider: "codex_cli", model: "private-model-a", reasoning_effort: "high", estimated_tokens: 100 },
      { provider: "claude_cli", model: "private-model-b", reasoning_effort: "high", estimated_tokens: 200 },
      { provider: "agy_cli", model: "private-model-c", reasoning_effort: "high", estimated_tokens: 300 },
    ],
    synthesizer_route: { provider: "claude_cli", model: "private-synth", reasoning_effort: "high", estimated_tokens: 400 },
    arbitration_route: { provider: "codex_cli", model: "private-arbiter", reasoning_effort: "xhigh", estimated_tokens: 500 },
    token_envelope: { fanout_tokens: 600, consolidation_tokens: 400, optional_arbitration_tokens: 500, minimum_tokens: 1_000, maximum_tokens: 1_500 },
    child_run_ids: ["run-a", "run-b", "run-c"],
    consolidation_run_id: "run-synth",
    arbitration_run_id: null,
    conflicts: [{ conflict_id: "conflict-private", output_run_ids: ["run-a", "run-b"], summary: "private conflict", material: true }],
    final_artifact: "private artifact",
    status: "needs_arbitration",
    revision: 7,
    approval_state: "reserved",
    orchestration_group_id: "private-group",
    slots: [
      { slot_id: "fanout-0", stage: "fanout", route_index: 0, run_id: "run-a", state: "terminal" },
      { slot_id: "fanout-1", stage: "fanout", route_index: 1, run_id: "run-b", state: "terminal" },
      { slot_id: "fanout-2", stage: "fanout", route_index: 2, run_id: "run-c", state: "terminal" },
      { slot_id: "consolidation", stage: "consolidation", route_index: null, run_id: "run-synth", state: "terminal" },
      { slot_id: "arbitration", stage: "arbitration", route_index: null, run_id: null, state: "planned" },
    ],
    approved_by: "private-operator",
    created_at: createdAt,
    updated_at: at,
  };
}

function run(runId: string, totalTokens: number | null): RunRecord {
  return {
    current: { run_id: runId },
    token_settlement: totalTokens === null ? null : { inputTokens: Math.max(0, totalTokens - 1), outputTokens: Math.min(1, totalTokens), totalTokens },
  } as RunRecord;
}

describe("brainstorm telemetry", () => {
  it("uses the envelope maximum once and sums each required fixed-slot settlement once", () => {
    const record = brainstorm();
    const event = buildBrainstormTelemetryEvent(record, [
      run("run-a", 11), run("run-b", 22), run("run-c", 33), run("run-synth", 44), run("run-a", 11), run("unrelated", 9_999),
    ], "consolidated", at);

    expect(event).toEqual({
      schema_version: "v1",
      event: "consolidated",
      brainstorm_id: "brainstorm-safe-id",
      provider_count: 3,
      material_conflict_count: 1,
      estimated_tokens: 1_500,
      actual_tokens: 110,
      duration_ms: 2_500,
      at,
    });
    expect(Object.keys(event).sort()).toEqual([
      "actual_tokens", "at", "brainstorm_id", "duration_ms", "estimated_tokens", "event", "material_conflict_count", "provider_count", "schema_version",
    ]);
    expect(JSON.stringify(event)).not.toMatch(/private|model-a|model-b|model-c|private-project|private-operator|private artifact|run-/i);
  });

  it("fails closed to null when any required durable settlement is absent", () => {
    const event = buildBrainstormTelemetryEvent(brainstorm(), [
      run("run-a", 11), run("run-b", null), run("run-c", 33), run("run-synth", 44),
    ], "consolidated", at);
    expect(event.actual_tokens).toBeNull();
  });

  it("persists one immutable event per brainstorm and lifecycle phase", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "brainstorm-telemetry-"));
    const event = buildBrainstormTelemetryEvent(brainstorm(), [], "created", createdAt);
    expect(recordBrainstormTelemetryEvent(stateDir, event)).toEqual(event);
    expect(recordBrainstormTelemetryEvent(stateDir, event)).toEqual(event);
    expect(readBrainstormTelemetry(stateDir).events).toEqual([event]);

    expect(() => recordBrainstormTelemetryEvent(stateDir, { ...event, duration_ms: 1 })).toThrow("brainstorm_telemetry_conflict");
    expect(readBrainstormTelemetry(stateDir).events).toHaveLength(1);
  });

  it("rejects unknown fields and malformed or oversized durable state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "brainstorm-telemetry-invalid-"));
    const path = join(stateDir, "brainstorm-telemetry.json");
    const event = buildBrainstormTelemetryEvent(brainstorm(), [], "created", createdAt);
    expect(() => recordBrainstormTelemetryEvent(stateDir, { ...event, usd_cost: 1 } as never)).toThrow("invalid_brainstorm_telemetry");

    writeFileSync(path, JSON.stringify({ schema_version: "v1", events: [{ ...event, raw_output: "secret" }] }));
    expect(() => readBrainstormTelemetry(stateDir)).toThrow("invalid_brainstorm_telemetry_store");

    mkdirSync(join(stateDir, "nested"));
    writeFileSync(path, "x".repeat(2 * 1024 * 1024 + 1));
    expect(() => readBrainstormTelemetry(stateDir)).toThrow("invalid_brainstorm_telemetry_store");
  });
});
