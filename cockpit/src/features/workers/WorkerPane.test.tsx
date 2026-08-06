import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import axe from "axe-core";
import { WorkerPane } from "./WorkerPane";
import { boundedOutputTail, elapsedLabel, sortWorkers, type WorkerRecord } from "./workerSelectors";

const base: WorkerRecord = { worker_run_id: "worker-running", vendor: "claude_cli", model: "claude", session_id: "session-1", status: "running", started_at: "2026-07-11T10:00:00.000Z", output: "tail output" };
function mount(node: React.ReactNode) { const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); act(() => root.render(node)); return { host, root }; }

describe("worker selectors", () => {
  it("sorts running before blocked, error, completed", () => { const result = sortWorkers([{ ...base, status: "completed" }, { ...base, worker_run_id: "blocked", status: "blocked" }, { ...base, worker_run_id: "error", status: "error" }]); expect(result.map((worker) => worker.status)).toEqual(["blocked", "error", "completed"]); });
  it("keeps only bounded output tail", () => { expect(boundedOutputTail("x".repeat(401), 400)).toHaveLength(400); expect(boundedOutputTail("x".repeat(401), 400).startsWith("…")).toBe(true); });
  it("formats elapsed time", () => { expect(elapsedLabel(base, new Date("2026-07-11T10:01:05.000Z"))).toBe("1m 5s"); });
});

describe("WorkerPane", () => {
  it("renders each worker state and terminal tail", () => { const { host, root } = mount(<WorkerPane workers={[base, { ...base, worker_run_id: "done", status: "completed", finished_at: "2026-07-11T10:00:10.000Z" }, { ...base, worker_run_id: "blocked", status: "blocked" }, { ...base, worker_run_id: "failed", status: "error", error_reason: "failed" }]} now={new Date("2026-07-11T10:01:00.000Z")} />); expect(host.textContent).toContain("Běží"); expect(host.textContent).toContain("Dokončeno"); expect(host.textContent).toContain("Blokováno"); expect(host.textContent).toContain("Chyba"); expect(host.textContent).toContain("Výstup terminálu"); expect(host.textContent).toContain("tail output"); act(() => root.unmount()); host.remove(); });
  it("shows empty state", () => { const { host, root } = mount(<WorkerPane workers={[]} />); expect(host.textContent).toContain("Žádní běžící workeři."); act(() => root.unmount()); host.remove(); });
  it("shows the localized output fallback", () => { const { host, root } = mount(<WorkerPane workers={[{ ...base, output: "" }]} />); expect(host.textContent).toContain("Žádný zachycený výstup."); act(() => root.unmount()); host.remove(); });
  it("requires cancellation confirmation and invokes callback", () => { const calls: string[] = []; const { host, root } = mount(<WorkerPane workers={[base]} onCancel={(worker) => calls.push(worker.worker_run_id)} />); const cancel = [...host.querySelectorAll("button")].find((button) => button.textContent === "Zrušit") as HTMLButtonElement; act(() => cancel.click()); expect(host.textContent).toContain("Zrušit tohoto workera?"); const confirm = [...host.querySelectorAll("button")].find((button) => button.textContent === "Potvrdit zrušení") as HTMLButtonElement; act(() => confirm.click()); expect(calls).toEqual(["worker-running"]); act(() => root.unmount()); host.remove(); });
  it("keeps cancel confirmation and surfaces rejected cancellation", async () => { const { host, root } = mount(<WorkerPane workers={[base]} onCancel={async () => { throw new Error("worker already exited"); }} />); const cancel = [...host.querySelectorAll("button")].find((button) => button.textContent === "Zrušit") as HTMLButtonElement; act(() => cancel.click()); const confirm = [...host.querySelectorAll("button")].find((button) => button.textContent === "Potvrdit zrušení") as HTMLButtonElement; await act(async () => { confirm.click(); }); expect(host.textContent).toContain("Zrušení selhalo: worker already exited"); expect(host.textContent).toContain("Zrušit tohoto workera?"); act(() => root.unmount()); host.remove(); });
  it("selects a worker locally when no selection callback is supplied", () => { const second = { ...base, worker_run_id: "worker-second", output: "second output" }; const { host, root } = mount(<WorkerPane workers={[base, second]} />); const secondTab = [...host.querySelectorAll('[role="tab"]')][1] as HTMLButtonElement; act(() => secondTab.click()); expect(host.textContent).toContain("second output"); act(() => root.unmount()); host.remove(); });
  it("does not offer a successful cancel when no callback is supplied", () => { const { host, root } = mount(<WorkerPane workers={[base]} />); const unavailable = [...host.querySelectorAll("button")].find((button) => button.textContent === "Zrušení nedostupné") as HTMLButtonElement; expect(unavailable.disabled).toBe(true); act(() => root.unmount()); host.remove(); });
  it("has no axe violations", async () => { const { host, root } = mount(<WorkerPane workers={[base]} />); const result = await axe.run(host, { rules: { "color-contrast": { enabled: false } } }); expect(result.violations).toEqual([]); act(() => root.unmount()); host.remove(); });
});
