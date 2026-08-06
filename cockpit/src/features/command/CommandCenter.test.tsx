import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { ControlPlaneStatus, RunDraft, RunRecord } from "../../types/controlPlane";
import { CommandCenter, STALE_RUN_MS } from "./CommandCenter";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function draft(overrides: Partial<RunDraft> = {}): RunDraft {
  return {
    project_id: "proj-1",
    prompt: "do the thing",
    provider: "codex_cli",
    model: "gpt-5.6-sol",
    estimated_tokens: 1_200,
    requested_artifacts: ["text"],
    requested_reasoning_effort: null,
    promotion_packet_id: null,
    run_id: "run-1",
    revision: 1,
    input_token_bound: 1_000,
    output_token_allowance: 500,
    profile: "dev",
    created_at: "2026-07-11T10:00:00.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  const current = overrides.current ?? draft();
  return {
    schema_version: "v1",
    current,
    revisions: [current],
    status: "running",
    approved_revision: 1,
    approved_by: "owner",
    approved_at: "2026-07-11T10:00:00.000Z",
    supervisor_task_id: null,
    worker_run_id: null,
    terminal_reason: null,
    token_reservation: null,
    reservation_status: "none",
    provider_result: null,
    cancellation_requested: false,
    queue_compensation_requested: false,
    dispatch_failure: null,
    retry_input_tokens: 0,
    retry_output_tokens: 0,
    artifacts: [],
    updated_at: "2026-07-11T10:00:00.000Z",
    ...overrides,
  };
}

const status: ControlPlaneStatus = {
  sessions: { total: 8, active: 2, closed: 6 },
  approvals: { total: 9, pending: 3, approved: 5, rejected: 1 },
  telemetry: { calls: 7, successful: 6, total_tokens: 42 },
};

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  return [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label) as HTMLButtonElement;
}

describe("CommandCenter", () => {
  it("renders the Control Plane status strip", () => {
    const { host, root } = mount(
      <CommandCenter
        runs={[]}
        onSelectRun={vi.fn()}
        status={status}
        refreshedAt="2026-07-11T10:15:20.000Z"
        approvalPane={<p>APPROVALS</p>}
      />,
    );

    expect([...host.querySelectorAll(".cc-status-strip li")].map((item) => item.textContent)).toEqual([
      "Relace 2/8",
      "Schválení čeká: 3",
      "7 volání · 42 tokenů",
      "Obnoveno 10:15:20 UTC",
    ]);

    act(() => root.unmount());
    host.remove();
  });

  it("omits unavailable status items when the Control Plane payload is partial", () => {
    const { host, root } = mount(
      <CommandCenter
        runs={[]}
        onSelectRun={vi.fn()}
        status={{ telemetry: { calls: 0, total_tokens: 0 } } as ControlPlaneStatus}
        approvalPane={null}
      />,
    );

    expect([...host.querySelectorAll(".cc-status-strip li")].map((item) => item.textContent)).toEqual([
      "0 volání · 0 tokenů",
    ]);

    act(() => root.render(
      <CommandCenter
        runs={[]}
        onSelectRun={vi.fn()}
        status={{
          sessions: { active: 2 },
          approvals: {},
          telemetry: { calls: 7 },
        } as ControlPlaneStatus}
        approvalPane={null}
      />,
    ));
    expect(host.querySelectorAll(".cc-status-strip li")).toHaveLength(0);

    act(() => root.unmount());
    host.remove();
  });

  it("keeps loading exclusive and otherwise orders error and refresh states around status", () => {
    const { host, root } = mount(
      <CommandCenter
        runs={[]}
        onSelectRun={vi.fn()}
        status={status}
        refreshedAt="2026-07-11T10:15:20.000Z"
        loading
        refreshing
        statusError="offline"
        approvalPane={null}
      />,
    );
    expect([...host.querySelectorAll(".cc-status-strip li")].map((item) => item.textContent)).toEqual(["Připojuji Control Plane…"]);

    act(() => root.render(
      <CommandCenter
        runs={[]}
        onSelectRun={vi.fn()}
        status={status}
        refreshing
        statusError="offline"
        approvalPane={null}
      />,
    ));
    const items = [...host.querySelectorAll(".cc-status-strip li")];
    expect(items[0]?.textContent).toBe("Stav není dostupný: offline");
    expect(items[0]?.querySelector(".cc-status-error")).not.toBeNull();
    expect(items.at(-1)?.textContent).toBe("Obnovuji…");

    act(() => root.unmount());
    host.remove();
  });

  it("approves a draft run from the waiting hub", async () => {
    const draftRun = run({ current: draft({ run_id: "run-draft" }), status: "draft" });
    const onApproveRun = vi.fn().mockResolvedValue(undefined);
    const { host, root } = mount(
      <CommandCenter runs={[draftRun]} onSelectRun={vi.fn()} onApproveRun={onApproveRun} approvalPane={null} />,
    );

    act(() => button(host, "Schválit").click());
    const confirmation = host.querySelector('[role="group"]');
    expect(confirmation?.textContent).toContain("Opravdu schválit a spustit běh?");
    expect(button(host, "Potvrdit schválení")).toBeDefined();
    expect(button(host, "Ponechat")).toBeDefined();
    expect(onApproveRun).not.toHaveBeenCalled();

    await act(async () => {
      button(host, "Potvrdit schválení").click();
      await Promise.resolve();
    });
    expect(onApproveRun).toHaveBeenCalledWith(draftRun);
    expect(onApproveRun).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    host.remove();
  });

  it("confirms cancellation before cancelling a queued run", async () => {
    const queuedRun = run({ current: draft({ run_id: "run-queued" }), status: "queued" });
    const onCancelRun = vi.fn().mockResolvedValue(undefined);
    const { host, root } = mount(
      <CommandCenter runs={[queuedRun]} onSelectRun={vi.fn()} onCancelRun={onCancelRun} approvalPane={null} />,
    );

    act(() => button(host, "Zrušit").click());
    const confirmation = host.querySelector('[role="group"]');
    expect(confirmation?.textContent).toContain("Opravdu zrušit běh?");
    expect(onCancelRun).not.toHaveBeenCalled();

    await act(async () => {
      button(host, "Potvrdit zrušení").click();
      await Promise.resolve();
    });
    expect(onCancelRun).toHaveBeenCalledWith(queuedRun);
    expect(onCancelRun).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    host.remove();
  });

  it("shows a bounded inline action error when cancellation fails", async () => {
    const queuedRun = run({ current: draft({ run_id: "run-queued" }), status: "queued" });
    const onCancelRun = vi.fn().mockRejectedValue(new Error("x".repeat(350)));
    const { host, root } = mount(
      <CommandCenter runs={[queuedRun]} onSelectRun={vi.fn()} onCancelRun={onCancelRun} approvalPane={null} />,
    );

    act(() => button(host, "Zrušit").click());
    await act(async () => {
      button(host, "Potvrdit zrušení").click();
      await Promise.resolve();
    });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(`Akce selhala: ${"x".repeat(300)}`);

    act(() => root.unmount());
    host.remove();
  });

  it("shows stale, failure, dispatch, cancellation, and terminal indicators", () => {
    const injectedNow = new Date("2026-07-11T10:30:00.000Z");
    const staleRun = run({
      current: draft({ run_id: "run-stale" }),
      status: "running",
      updated_at: new Date(injectedNow.getTime() - STALE_RUN_MS - 1).toISOString(),
      dispatch_failure: "dispatch exploded",
      cancellation_requested: true,
    });
    const oldStaleRun = run({
      current: draft({ run_id: "run-stale-hours" }),
      status: "queued",
      updated_at: new Date(injectedNow.getTime() - 2 * 60 * 60_000 - 5 * 60_000).toISOString(),
    });
    const failedRun = run({
      current: draft({ run_id: "run-failed" }),
      status: "failed",
      terminal_reason: "y".repeat(100),
    });
    const { host, root } = mount(
      <CommandCenter runs={[failedRun, staleRun, oldStaleRun]} now={injectedNow} onSelectRun={vi.fn()} approvalPane={null} />,
    );

    const staleCard = [...host.querySelectorAll(".cc-run-card")].find((card) => card.textContent?.includes("run-stale"));
    expect(staleCard?.querySelector(".cc-run-chip-stale")?.textContent).toBe("Zastaralé 15 min");
    expect(staleCard?.textContent).toContain("dispatch selhal");
    expect(staleCard?.textContent).toContain("ruší se…");
    const failedCard = [...host.querySelectorAll(".cc-run-card")].find((card) => card.textContent?.includes("run-failed"));
    expect(failedCard?.querySelector(".cc-run-dot-failed")).not.toBeNull();
    expect(failedCard?.querySelector(".cc-run-terminal-reason")?.textContent).toBe("y".repeat(80));
    const oldStaleCard = [...host.querySelectorAll(".cc-run-card")].find((card) => card.textContent?.includes("run-stale-hours"));
    expect(oldStaleCard?.querySelector(".cc-run-chip-stale")?.textContent).toBe("Zastaralé 2 h");

    act(() => root.unmount());
    host.remove();
  });

  it("localizes run statuses on pending cards and run rows", () => {
    const statuses = [
      ["draft", "Koncept"],
      ["queued", "Ve frontě"],
      ["running", "Běží"],
      ["failed", "Selhalo"],
      ["completed", "Dokončeno"],
      ["cancelled", "Zrušeno"],
    ] as const;
    const runs = statuses.map(([statusName], index) => run({
      current: draft({ run_id: `run-${statusName}` }),
      status: statusName,
      updated_at: `2026-07-11T10:00:0${index}.000Z`,
    }));
    const { host, root } = mount(
      <CommandCenter runs={runs} onSelectRun={vi.fn()} approvalPane={null} />,
    );

    for (const [statusName, expected] of statuses) {
      const card = [...host.querySelectorAll(".cc-run-card")].find((candidate) => candidate.textContent?.includes(`run-${statusName}`));
      expect(card?.querySelector(".cc-run-status")?.textContent).toBe(expected);
    }
    expect([...host.querySelectorAll(".cc-pending-status")].map((item) => item.textContent)).toEqual(expect.arrayContaining(["Koncept", "Ve frontě"]));

    act(() => root.unmount());
    host.remove();
  });

  it("renders integration slots, keeps run ordering, and removes the incidents card", () => {
    const onSelectRun = vi.fn();
    const runningRun = run({ current: draft({ run_id: "run-running" }), status: "running", updated_at: "2026-07-11T11:00:00.000Z" });
    const waitingRun = run({ current: draft({ run_id: "run-waiting", provider: "claude_cli", model: "opus" }), status: "queued", updated_at: "2026-07-11T12:00:00.000Z" });
    const { host, root } = mount(
      <CommandCenter
        runs={[waitingRun, runningRun]}
        selectedRunId="run-running"
        onSelectRun={onSelectRun}
        approvalPane={<p>APPROVALS</p>}
        figmaPane={<p>FIGMA</p>}
        incidentAlert={<p data-slot="incident-alert">INCIDENT ALERT</p>}
      />,
    );

    expect(host.querySelector(".command-center")?.firstElementChild?.getAttribute("data-slot")).toBe("incident-alert");
    expect(host.textContent).toContain("APPROVALS");
    expect(host.textContent).toContain("FIGMA");
    expect(host.textContent).toContain("INCIDENT ALERT");
    expect([...host.querySelectorAll("h3")].some((heading) => heading.textContent === "Incidenty")).toBe(false);
    const cards = [...host.querySelectorAll(".cc-run-card")];
    expect(cards[0]?.textContent).toContain("run-running");
    expect(cards[0]?.getAttribute("aria-pressed")).toBe("true");
    act(() => (cards[1] as HTMLButtonElement).click());
    expect(onSelectRun).toHaveBeenCalledWith("run-waiting");

    act(() => root.unmount());
    host.remove();
  });
});
