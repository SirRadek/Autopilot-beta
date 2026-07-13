import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { ObservabilityTimeline, RunRecord, RunStatus } from "../../types/controlPlane";
import { RunInspector } from "./RunInspector";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const statuses: readonly RunStatus[] = ["draft", "approved", "queued", "running", "completed", "failed", "cancelled"];
const baseRun = {
  schema_version: "v1", status: "completed", approved_revision: 1, approved_by: "operator", approved_at: "2026-07-13T10:01:00Z",
  current: { run_id: "run-1", revision: 1, project_id: "project-1", prompt: "Exact approved prompt", provider: "codex_cli", model: "gpt-5", estimated_tokens: 25, requested_artifacts: ["text", "visual"], created_at: "2026-07-13T10:00:00Z" },
  revisions: [], supervisor_task_id: "task-1", worker_run_id: "worker-1", terminal_reason: null,
  token_reservation: { reservationId: "reserve-1", provider: "codex_cli", model: "gpt-5", sessionId: null, inputTokens: 20, outputTokens: 5, reservedAt: "2026-07-13T10:01:00Z", totalTokens: 25 },
  reservation_status: "settled", provider_result: { refused: false, reason: null, worker_run_id: "worker-1", raw_output: "x".repeat(5000) },
  cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null,
  artifacts: [{ artifact_id: "artifact-1", type: "text", preview: "bounded result", created_at: "2026-07-13T10:02:00Z" }], updated_at: "2026-07-13T10:02:00Z",
} as RunRecord;
const timeline: ObservabilityTimeline = { summary: { events: 2, tokens: 25, retries: 3, refusals: 0, openrouter_cost_usd: 1.5, waste_signals: [] }, timeline: [{ at: "2026-07-13T10:01:00Z", source: "dispatch", event: "queued", session_id: null, handoff_id: null, worker_run_id: "worker-1", provider: "codex_cli", model: "gpt-5", tokens: 25, retries: 3, refused: false, cost_usd: 1.5, detail: "Bounded event" }], limits: { files_scanned: 1, max_bytes_per_file: 1024, max_lines_per_file: 10, max_events: 100, truncated: true } };

function mount(run: RunRecord = baseRun) { const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); act(() => root.render(<RunInspector run={run} timeline={timeline} />)); return { host, root }; }

describe("RunInspector", () => {
  it("renders every governed run state", () => { for (const status of statuses) { const { host, root } = mount({ ...baseRun, status }); expect(host.textContent).toContain(status); act(() => root.unmount()); host.remove(); } });
  it("shows exact approved input and bounded output", () => { const { host, root } = mount(); expect(host.textContent).toContain("Exact approved prompt"); expect(host.textContent).toContain("codex_cli"); expect(host.textContent).toContain("gpt-5"); expect(host.textContent).toContain("Výstup byl zkrácen"); act(() => root.unmount()); host.remove(); });
  it("shows timeline token, cost, retry, and truncation evidence", () => { const { host, root } = mount(); expect(host.textContent).toContain("25 tokenů"); expect(host.textContent).toContain("1.50 USD"); expect(host.textContent).toContain("3 opakování"); expect(host.textContent).toContain("Časová osa byla zkrácena"); act(() => root.unmount()); host.remove(); });
  it("reports requested visual output as unavailable", () => { const { host, root } = mount(); expect(host.textContent).toContain("Vizuální výstup není dostupný"); act(() => root.unmount()); host.remove(); });
});
