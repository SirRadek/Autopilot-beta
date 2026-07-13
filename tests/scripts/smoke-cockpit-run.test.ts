import { existsSync, readFileSync } from "node:fs";

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
      run_status: "completed",
      artifact_preview: "deterministic cockpit smoke result"
    });
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

  it("leaves no provider credentials or dispatch capability in its source", () => {
    const source = readFileSync(new URL("../../scripts/smoke-cockpit-run.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY/);
    expect(source).not.toContain("runCliWorker");
  });
});
