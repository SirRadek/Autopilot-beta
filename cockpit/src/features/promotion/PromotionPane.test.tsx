import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { PromotionPacket, RunRecord } from "../../types/controlPlane";
import { PromotionPane } from "./PromotionPane";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makePromotionPacket(overrides: Partial<PromotionPacket> = {}): PromotionPacket {
  return {
    schema_version: "v1",
    packet_id: "p0",
    source_run_id: "run-0",
    source_revision: 1,
    intent: "Publish",
    artifact_hash: "a".repeat(64),
    artifact_ref: "artifact://run-0/1",
    diff_summary: "Adds promotion pane",
    tests: ["npm test"],
    risks: ["none"],
    approvals: [],
    prod_run_id: null,
    full_verification_ref: null,
    release_acceptance_ref: null,
    rollback_ref: null,
    status: "promotion_pending",
    created_at: "2026-07-13T10:00:00.000Z",
    updated_at: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

function makeCompletedRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schema_version: "v1",
    current: { project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: "gpt-5", estimated_tokens: 100, requested_artifacts: ["text"], run_id: "run-1", revision: 2, input_token_bound: 200, output_token_allowance: 200, profile: "dev", requested_reasoning_effort: null, promotion_packet_id: null, created_at: "2026-07-13T10:00:00.000Z" },
    revisions: [],
    status: "completed",
    approved_revision: 2,
    approved_by: "cockpit-operator",
    approved_at: "2026-07-13T10:00:00.000Z",
    supervisor_task_id: null,
    worker_run_id: "worker-1",
    terminal_reason: null,
    token_reservation: null,
    reservation_status: "settled",
    provider_result: null,
    cancellation_requested: false,
    queue_compensation_requested: false,
    dispatch_failure: null,
    retry_input_tokens: 0,
    retry_output_tokens: 0,
    artifacts: [],
    updated_at: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

function mount(overrides: Partial<React.ComponentProps<typeof PromotionPane>> = {}) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const onPromote = vi.fn().mockResolvedValue(makePromotionPacket());
  const onApprovePromotion = vi.fn().mockResolvedValue(makePromotionPacket({ status: "approved" }));
  const onRejectPromotion = vi.fn().mockResolvedValue(makePromotionPacket({ status: "rejected" }));
  const prodDraft: RunRecord = { ...makeCompletedRun(), current: { ...makeCompletedRun().current, run_id: "run-prod-1", revision: 1, profile: "prod", promotion_packet_id: "p0" }, status: "draft", approved_revision: null, approved_by: null, approved_at: null, worker_run_id: null, reservation_status: "none" };
  const onPrepareProdDraft = vi.fn().mockResolvedValue(prodDraft);
  act(() => root.render(<PromotionPane packets={[]} onPromote={onPromote} onApprovePromotion={onApprovePromotion} onRejectPromotion={onRejectPromotion} onPrepareProdDraft={onPrepareProdDraft} {...overrides} />));
  return { host, root, onPromote, onApprovePromotion, onRejectPromotion, onPrepareProdDraft };
}

function button(host: HTMLElement, text: string) { return [...host.querySelectorAll("button")].find((item) => item.textContent === text) as HTMLButtonElement; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }

describe("PromotionPane", () => {
  it("lists packet status and approves a pending promotion", async () => {
    const packetFixture = makePromotionPacket({ packet_id: "p1", status: "promotion_pending", intent: "Publish", source_run_id: "run-1", source_revision: 2 });
    const { host, onApprovePromotion } = mount({ packets: [packetFixture] });
    expect(host.textContent).toContain("promotion_pending");
    await act(async () => button(host, "Schválit propagaci").click());
    expect(onApprovePromotion).toHaveBeenCalledWith("p1");
  });

  it("rejects a pending promotion", async () => {
    const packetFixture = makePromotionPacket({ packet_id: "p1", status: "promotion_pending" });
    const { host, onRejectPromotion } = mount({ packets: [packetFixture] });
    await act(async () => button(host, "Odmítnout").click());
    expect(onRejectPromotion).toHaveBeenCalledWith("p1");
  });

  it("promotes a completed DEV run into a packet", async () => {
    const completedRun = makeCompletedRun();
    const { host, onPromote } = mount({ promotableRuns: [completedRun] });
    expect(button(host, "Propagovat")).toBeDefined();
    await act(async () => button(host, "Propagovat").click());
    expect(onPromote).toHaveBeenCalledWith("run-1", expect.objectContaining({ intent: expect.any(String), diff_summary: expect.any(String), tests: expect.any(Array), risks: expect.any(Array) }));
  });

  it("does not offer Propagovat for a non-completed run", () => {
    const { host } = mount({ promotableRuns: [makeCompletedRun({ status: "running" })] });
    expect(button(host, "Propagovat")).toBeUndefined();
  });

  it("only enables Připravit PROD draft after approval and recorded full verification evidence", async () => {
    const pending = makePromotionPacket({ packet_id: "p1", status: "promotion_pending" });
    const approvedNoEvidence = makePromotionPacket({ packet_id: "p2", status: "approved", full_verification_ref: null });
    const approvedWithEvidence = makePromotionPacket({ packet_id: "p3", status: "approved", approvals: [{ approver: "owner", approved_at: "2026-07-13T10:00:00.000Z", review_ref: "review://p3" }], full_verification_ref: "verify://p3" });
    const { host, onPrepareProdDraft } = mount({ packets: [pending, approvedNoEvidence, approvedWithEvidence] });
    const buttons = [...host.querySelectorAll("button")].filter((item) => item.textContent === "Připravit PROD draft") as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(false);
    await act(async () => buttons[1]!.click());
    expect(onPrepareProdDraft).toHaveBeenCalledWith("p3");
  });

  it("requires the canonical owner approval before enabling a PROD draft", () => {
    const nonOwner = makePromotionPacket({ packet_id: "p4", status: "approved", approvals: [{ approver: "reviewer", approved_at: "2026-07-13T10:00:00.000Z", review_ref: "review://p4" }], full_verification_ref: "verify://p4" });
    const owner = makePromotionPacket({ packet_id: "p5", status: "approved", approvals: [{ approver: "owner", approved_at: "2026-07-13T10:00:00.000Z", review_ref: "review://p5" }], full_verification_ref: "verify://p5" });
    const { host } = mount({ packets: [nonOwner, owner] });
    const buttons = [...host.querySelectorAll("button")].filter((item) => item.textContent === "Připravit PROD draft") as HTMLButtonElement[];
    expect(buttons.map((item) => item.disabled)).toEqual([true, false]);
  });

  it("does not offer approve/reject once a promotion is no longer pending, and shows published as read-only evidence", () => {
    const published = makePromotionPacket({ packet_id: "p4", status: "published", full_verification_ref: "verify://p4", release_acceptance_ref: "accept://p4", rollback_ref: "rollback://p4", prod_run_id: "run-prod-1" });
    const { host } = mount({ packets: [published] });
    expect(button(host, "Schválit propagaci")).toBeUndefined();
    expect(button(host, "Odmítnout")).toBeUndefined();
    expect(button(host, "Připravit PROD draft")).toBeUndefined();
    expect(host.textContent).toContain("published");
    expect(host.textContent).toContain("run-prod-1");
  });

  it("globally guards every pending mutation against duplicate or competing clicks", async () => {
    const pending = makePromotionPacket({ packet_id: "p1", status: "promotion_pending" });
    const approval = deferred<PromotionPacket>();
    const guardedApprove = vi.fn(() => approval.promise);
    const { host, onRejectPromotion } = mount({ packets: [pending], onApprovePromotion: guardedApprove });
    const approve = button(host, "Schválit propagaci");
    const reject = button(host, "Odmítnout");
    act(() => { approve.click(); approve.click(); reject.click(); });
    expect(guardedApprove).toHaveBeenCalledTimes(1);
    expect(onRejectPromotion).not.toHaveBeenCalled();
    expect(approve.disabled).toBe(true);
    expect(reject.disabled).toBe(true);
    await act(async () => approval.resolve(makePromotionPacket({ status: "approved" })));

    const promotion = deferred<PromotionPacket>();
    const guardedPromote = vi.fn(() => promotion.promise);
    const promoteMount = mount({ promotableRuns: [makeCompletedRun()], onPromote: guardedPromote });
    act(() => { button(promoteMount.host, "Propagovat").click(); button(promoteMount.host, "Propagovat").click(); });
    expect(guardedPromote).toHaveBeenCalledTimes(1);
    await act(async () => promotion.resolve(makePromotionPacket()));

    const preparation = deferred<RunRecord>();
    const approved = makePromotionPacket({ status: "approved", approvals: [{ approver: "owner", approved_at: "2026-07-13T10:00:00.000Z", review_ref: "review://p" }], full_verification_ref: "verify://p" });
    const guardedPrepare = vi.fn(() => preparation.promise);
    const prepareMount = mount({ packets: [approved], onPrepareProdDraft: guardedPrepare });
    act(() => { button(prepareMount.host, "Připravit PROD draft").click(); button(prepareMount.host, "Připravit PROD draft").click(); });
    expect(guardedPrepare).toHaveBeenCalledTimes(1);
    await act(async () => preparation.resolve(makeCompletedRun()));
  });

  it("catches a mutation failure and announces it accessibly", async () => {
    const pending = makePromotionPacket({ packet_id: "p1", status: "promotion_pending" });
    const { host } = mount({ packets: [pending], onRejectPromotion: vi.fn().mockRejectedValue(new Error("refresh failed")) });
    await act(async () => button(host, "Odmítnout").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("refresh failed");
  });
});
