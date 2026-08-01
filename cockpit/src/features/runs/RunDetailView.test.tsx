import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { RunRecord } from "../../types/controlPlane";
import { RunDetailView } from "./RunDetailView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseDraft = { run_id: "run-1", revision: 1, project_id: "project-1", prompt: "Rate-limit /auth/login + testy", provider: "codex_cli", model: "gpt-5", input_token_bound: 21, output_token_allowance: 8_192, estimated_tokens: 900, requested_artifacts: ["text"], profile: "dev", requested_reasoning_effort: null, promotion_packet_id: null, created_at: "2026-07-13T10:00:00Z" };
const baseRun = {
  schema_version: "v1", status: "running", approved_revision: 1, approved_by: "operator", approved_at: "2026-07-13T10:01:00Z",
  current: baseDraft, revisions: [baseDraft], supervisor_task_id: "task-1", worker_run_id: "worker-1", terminal_reason: null,
  token_reservation: null, reservation_status: "active", provider_result: null,
  cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null,
  retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: "2026-07-13T10:02:00Z",
} as RunRecord;

function mount(run?: RunRecord) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  act(() => root.render(<RunDetailView run={run} runInspector={<p>inspector-slot</p>} promotionPane={<p>promotion-slot</p>} />));
  return { host, root };
}

describe("RunDetailView", () => {
  it("renders the status header from real run fields", () => { const { host, root } = mount(baseRun); expect(host.textContent).toContain("run-1 · revize 1 (immutable)"); expect(host.textContent).toContain("Rate-limit /auth/login + testy"); expect(host.textContent).toContain("stav running"); expect(host.textContent).toContain("codex_cli · gpt-5"); expect(host.textContent).toContain("odhad 900 tokenů"); expect(host.textContent).toContain("profil dev"); expect(host.querySelector(".status-badge")?.getAttribute("data-status")).toBe("running"); act(() => root.unmount()); host.remove(); });
  it("keeps run actions disabled as planned only", () => { const { host, root } = mount(baseRun); const buttons = [...host.querySelectorAll(".run-status-actions button")]; expect(buttons.map((button) => button.textContent)).toEqual(["Pauza", "Zastavit"]); for (const button of buttons) { expect((button as HTMLButtonElement).disabled).toBe(true); expect(button.getAttribute("title")).toBe("Planned"); } act(() => root.unmount()); host.remove(); });
  it("composes the inspector and promotion slots into labelled sections", () => { const { host, root } = mount(baseRun); expect(host.textContent).toContain("Průběh & důkazy"); expect(host.textContent).toContain("Propagace"); expect(host.textContent).not.toContain("Chyby"); expect(host.textContent).toContain("inspector-slot"); expect(host.textContent).toContain("promotion-slot"); expect(host.querySelectorAll(".run-detail-section[aria-labelledby]")).toHaveLength(2); act(() => root.unmount()); host.remove(); });
  it("falls back to run_id as title when the prompt is empty", () => { const { host, root } = mount({ ...baseRun, current: { ...baseRun.current, prompt: "   " } }); expect(host.querySelector(".run-status-title h2")?.textContent).toBe("run-1"); act(() => root.unmount()); host.remove(); });
  it("shows an empty state without a selected run", () => { const { host, root } = mount(undefined); expect(host.textContent).toContain("Vyber běh v Command Center."); expect(host.textContent).not.toContain("inspector-slot"); act(() => root.unmount()); host.remove(); });
  it("uses instance-scoped section ids", () => { const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); act(() => root.render(<><RunDetailView run={baseRun} runInspector={null} promotionPane={null} /><RunDetailView run={baseRun} runInspector={null} promotionPane={null} /></>)); const ids = [...host.querySelectorAll("[id]")].map((node) => node.id); expect(new Set(ids).size).toBe(ids.length); act(() => root.unmount()); host.remove(); });
});
