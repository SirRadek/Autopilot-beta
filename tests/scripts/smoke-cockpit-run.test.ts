import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCockpitSmoke } from "../../scripts/smoke-cockpit-run";

describe("cockpit governed run smoke harness", () => {
  it("runs one deterministic worker through the real governed path and removes temporary state", async () => {
    const result = await runCockpitSmoke({ mode: "dry-run" });

    expect(result).toMatchObject({
      mode: "dry-run",
      provider_invoked: false,
      approved_revisions: 1,
      reservations: 1,
      supervisor_tasks: 1,
      worker_results: 1,
      reservation_status: "settled",
      run_status: "completed"
    });
    expect(result.artifact_preview).toHaveLength(2_083);
    expect(result.artifact_preview).toMatch(/^deterministic cockpit smoke result\n/);
    expect(result.correlation_ids).toEqual({
      run_id: result.run_id,
      session_id: result.run_id,
      handoff_id: `run-handoff-${result.run_id}-1`,
      worker_run_id: "smoke-worker-1",
      supervisor_task_id: result.supervisor_task_id,
      reservation_id: result.reservation_id
    });
    expect(result.terminal_reservation_events).toEqual(["settled"]);
    expect(existsSync(result.state_dir)).toBe(false);
  });

  it("rejects live execution before creating state or invoking a provider", async () => {
    await expect(runCockpitSmoke({ mode: "live" })).rejects.toThrow("live_execution_forbidden");
  });

  it("rejects a duplicated persisted reservation lifecycle", async () => {
    await expect(runCockpitSmoke({ mode: "dry-run", beforeEvidenceInspection: (stateDir) => {
      const path = join(stateDir, "token-gateway-telemetry.jsonl");
      const reserved = readFileSync(path, "utf8").split("\n").find((line) => line.includes('"event":"reserved"'))!;
      appendFileSync(path, `${reserved}\n`);
    } })).rejects.toThrow("smoke_reservation_lifecycle_mismatch");
  });

  it("rejects a mismatched persisted supervisor handoff", async () => {
    await expect(runCockpitSmoke({ mode: "dry-run", beforeEvidenceInspection: (stateDir) => {
      const path = join(stateDir, "supervisor-queue.json");
      const state = JSON.parse(readFileSync(path, "utf8"));
      state.tasks[0].handoff.sessionId = "mismatched-session";
      writeFileSync(path, JSON.stringify(state));
    } })).rejects.toThrow("smoke_correlation_mismatch");
  });

  it("rejects an unrelated approval record", async () => {
    await expect(runCockpitSmoke({ mode: "dry-run", beforeEvidenceInspection: (stateDir) => {
      const path = join(stateDir, "approval-queue.json");
      const state = JSON.parse(readFileSync(path, "utf8"));
      state.records.push({ ...state.records[0], approval_id: "unrelated-approval", run_id: "unrelated-run", session_id: "unrelated-run" });
      writeFileSync(path, JSON.stringify(state));
    } })).rejects.toThrow("smoke_persisted_count_mismatch");
  });

  it("rejects an unrelated reservation lifecycle", async () => {
    await expect(runCockpitSmoke({ mode: "dry-run", beforeEvidenceInspection: (stateDir) => {
      const path = join(stateDir, "token-gateway-telemetry.jsonl");
      const records = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      const unrelated = records.filter((record) => record.event === "reserved" || record.event === "settled").map((record) => ({ ...record, reservation_id: "unrelated-reservation", handoff_id: "unrelated-handoff", session_id: "unrelated-run" }));
      appendFileSync(path, `${unrelated.map((record) => JSON.stringify(record)).join("\n")}\n`);
    } })).rejects.toThrow("smoke_reservation_lifecycle_mismatch");
  });

  it("rejects an unrelated supervisor task", async () => {
    await expect(runCockpitSmoke({ mode: "dry-run", beforeEvidenceInspection: (stateDir) => {
      const path = join(stateDir, "supervisor-queue.json");
      const state = JSON.parse(readFileSync(path, "utf8"));
      state.tasks.push({ ...state.tasks[0], task_id: "unrelated-task" });
      writeFileSync(path, JSON.stringify(state));
    } })).rejects.toThrow("smoke_persisted_count_mismatch");
  });

  it("leaves no provider credentials or dispatch capability in its source", () => {
    const source = readFileSync(new URL("../../scripts/smoke-cockpit-run.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY/);
    expect(source).not.toContain("runCliWorker");
  });
});
