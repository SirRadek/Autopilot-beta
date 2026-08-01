import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { RunDraft, RunRecord } from "../../types/controlPlane";
import { CommandCenter } from "./CommandCenter";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function draft(overrides: Partial<RunDraft>): RunDraft {
  return { project_id: "proj-1", prompt: "do the thing", provider: "codex_cli", model: "gpt-5.6-sol", estimated_tokens: 1200, requested_artifacts: ["text"], requested_reasoning_effort: null, promotion_packet_id: null, run_id: "run-1", revision: 1, input_token_bound: 1000, output_token_allowance: 500, profile: "dev", created_at: "2026-07-11T10:00:00.000Z", ...overrides };
}

function run(overrides: Partial<RunRecord> & { readonly current: RunDraft }): RunRecord {
  return { schema_version: "v1", revisions: [overrides.current], status: "running", approved_revision: 1, approved_by: "owner", approved_at: "2026-07-11T10:00:00.000Z", supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-07-11T10:00:00.000Z", ...overrides };
}

const runningRun = run({ current: draft({ run_id: "run-running" }), status: "running" });
const waitingRun = run({ current: draft({ run_id: "run-waiting", provider: "claude_cli", model: "opus" }), status: "queued" });
const runs: RunRecord[] = [waitingRun, runningRun];

function mount(node: React.ReactNode) { const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); act(() => root.render(node)); return { host, root }; }

describe("CommandCenter", () => {
  it("renders telemetry, run cards sorted running-first, and reused approval/incident slots", () => {
    const onSelectRun = vi.fn();
    const { host, root } = mount(<CommandCenter runs={runs} selectedRunId="run-running" onSelectRun={onSelectRun} telemetry={{ calls: 7, total_tokens: 4200 }} approvalPane={<p>APPROVALS</p>} incidentPane={<p>INCIDENTS</p>} />);
    expect(host.textContent).toContain("Command Center");
    expect(host.textContent).toContain("7 worker calls · 4200 tokens");
    expect(host.textContent).toContain("APPROVALS");
    expect(host.textContent).toContain("INCIDENTS");
    const cards = [...host.querySelectorAll(".cc-run-card")];
    expect(cards.map((card) => card.textContent?.includes("run-running"))).toEqual([true, false]);
    expect(cards[0]?.getAttribute("aria-pressed")).toBe("true");
    act(() => cards[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelectRun).toHaveBeenCalledWith("run-waiting");
    act(() => root.unmount()); host.remove();
  });

  it("shows an empty state when there are no runs", () => {
    const { host, root } = mount(<CommandCenter runs={[]} onSelectRun={vi.fn()} approvalPane={<p>APPROVALS</p>} incidentPane={<p>INCIDENTS</p>} />);
    expect(host.textContent).toContain("Žádné běhy.");
    act(() => root.unmount()); host.remove();
  });
});
