import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { BrainstormRecord, ProjectEntry, ProviderModels, ProviderQuota, RunRecord } from "../../types/controlPlane";
import { BrainstormPane } from "./BrainstormPane";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const projects: readonly ProjectEntry[] = [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: "/private/not-submitted", enabled: true }];

function quotaFor(provider: string): ProviderQuota {
  return { provider, source: "cli", fetched_at: "2026-07-22T10:00:00.000Z", observed_at: "2026-07-22T10:00:00.000Z", five_hour: { limit: 1000, used: 0, remaining: 1000, resets_at: null }, weekly: { limit: 5000, used: 0, remaining: 5000, resets_at: null }, api_spend: null, currency: null, models: [{ model_id: "model-x", available: true, health: "healthy", source: "cli" }], health: "healthy", error_code: null, freshness: "fresh", next_poll_at: null };
}

const quotas: readonly ProviderQuota[] = [quotaFor("codex_cli"), quotaFor("claude_cli"), quotaFor("agy_cli")];
const models: ProviderModels = {
  freshness: "fresh", fetched_at: quotas[0]!.fetched_at, next_poll_at: null,
  models: [{ model_id: "model-x", providers: ["codex_cli", "claude_cli", "agy_cli"], available: true, health: ["healthy"], reasoning_efforts: ["low", "medium"], provider_routes: [{ provider: "codex_cli", reasoning_efforts: ["low", "medium"] }, { provider: "claude_cli", reasoning_efforts: ["low", "medium"] }, { provider: "agy_cli", reasoning_efforts: ["low", "medium"] }] }],
};

const quotasWithOpenrouter: readonly ProviderQuota[] = [quotaFor("codex_cli"), quotaFor("claude_cli"), quotaFor("openrouter_api")];
const modelsWithOpenrouter: ProviderModels = {
  freshness: "fresh", fetched_at: quotas[0]!.fetched_at, next_poll_at: null,
  models: [{ model_id: "model-x", providers: ["codex_cli", "claude_cli", "openrouter_api"], available: true, health: ["healthy"], reasoning_efforts: ["low", "medium"], provider_routes: [{ provider: "codex_cli", reasoning_efforts: ["low", "medium"] }, { provider: "claude_cli", reasoning_efforts: ["low", "medium"] }, { provider: "openrouter_api", reasoning_efforts: [] }] }],
};

const draftRecord: BrainstormRecord = {
  schema_version: "v1", brainstorm_id: "bs-1", project_id: "autopilot-beta", brief: "Explore approaches",
  routes: [], synthesizer_route: { provider: "codex_cli", model: "model-x", reasoning_effort: "low", estimated_tokens: 100 }, arbitration_route: null,
  token_envelope: { fanout_tokens: 0, consolidation_tokens: 10_000, optional_arbitration_tokens: 0, minimum_tokens: 10_000, maximum_tokens: 10_000 },
  child_run_ids: [], consolidation_run_id: null, arbitration_run_id: null, conflicts: [], final_artifact: null, status: "draft", revision: 1, approval_state: "none", orchestration_group_id: null, slots: [], approved_by: null, created_at: quotas[0]!.fetched_at, updated_at: quotas[0]!.fetched_at,
};

function mount(overrides: Partial<React.ComponentProps<typeof BrainstormPane>> = {}) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const onCreate = vi.fn(async (input) => ({ ...draftRecord, brief: input.brief }));
  const onApprove = vi.fn().mockResolvedValue({ ...draftRecord, status: "fanout_running" });
  const onArbitrate = vi.fn().mockResolvedValue({ ...draftRecord, status: "arbitrating" });
  act(() => root.render(<BrainstormPane environment="dev" projects={projects} quotas={quotas} models={models} brainstorms={[]} runs={[]} onCreate={onCreate} onApprove={onApprove} onArbitrate={onArbitrate} {...overrides} />));
  return { host, root, onCreate, onApprove, onArbitrate };
}

function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string | boolean) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), typeof value === "boolean" ? "checked" : "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement || typeof value === "boolean" ? "change" : "input", { bubbles: true }));
  });
}
function button(host: HTMLElement, text: string) { return [...host.querySelectorAll("button")].find((item) => item.textContent === text) as HTMLButtonElement; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function fillFullPlan(host: HTMLElement) {
  change(host.querySelector('[aria-label="Brief"]')!, "Explore approaches");
  for (const provider of ["codex_cli", "claude_cli", "agy_cli"]) {
    change(host.querySelector(`[aria-label="Model ${provider}"]`) as HTMLSelectElement, "model-x");
    change(host.querySelector(`[aria-label="Reasoning ${provider}"]`) as HTMLSelectElement, "low");
  }
  change(host.querySelector('[aria-label="Syntezátor"]') as HTMLSelectElement, "codex_cli");
  change(host.querySelector('[aria-label="Arbitr"]') as HTMLSelectElement, "__opt_out__");
}

describe("BrainstormPane", () => {
  it("treats missing top-level server collections as empty", () => {
    const { host, root } = mount({
      projects: undefined as never,
      quotas: undefined as never,
      brainstorms: undefined as never,
      runs: undefined as never,
    });

    expect((host.querySelector('[aria-label="Brainstorm projekt"]') as HTMLSelectElement).options).toHaveLength(0);
    expect(host.querySelectorAll(".brainstorm-route-card")).toHaveLength(0);
    expect(host.textContent).toContain("Nedostatek ověřených poskytovatelů pro brainstorm");

    act(() => root.unmount()); host.remove();
  });

  it("treats incomplete provider collections as having no eligible models", () => {
    const partialQuota = { provider: "codex_cli", freshness: "fresh", health: "healthy" } as ProviderQuota;
    const partialModels = { models: [{ model_id: "incomplete-model" }] } as unknown as ProviderModels;
    const { host, root } = mount({ quotas: [partialQuota], models: partialModels });

    expect([...((host.querySelector('[aria-label="Model codex_cli"]') as HTMLSelectElement).options)].map((option) => option.value)).toEqual([""]);
    expect(host.textContent).toContain("Nedostatek ověřených poskytovatelů pro brainstorm");

    act(() => root.unmount()); host.remove();
  });

  it("omits incomplete detail collections from a partial brainstorm record", () => {
    const partialRecord = {
      brainstorm_id: "bs-partial",
      project_id: "autopilot-beta",
      status: "completed",
      final_artifact: null,
      consolidation_run_id: null,
      arbitration_run_id: null,
    } as BrainstormRecord;
    const { host, root } = mount({ brainstorms: [partialRecord], runs: [{} as RunRecord] });

    expect(host.querySelector('[aria-label="Brainstorm bs-partial"]')).not.toBeNull();
    expect(host.textContent).toContain("bs-partial");
    expect(host.querySelector('[aria-label="Konflikty"]')).toBeNull();

    act(() => root.unmount()); host.remove();
  });

  it("fails closed when a prepared brainstorm omits its token envelope", async () => {
    const incompleteDraft = { ...draftRecord, token_envelope: undefined } as unknown as BrainstormRecord;
    const onCreate = vi.fn().mockResolvedValue(incompleteDraft);
    const { host, root } = mount({ onCreate });
    fillFullPlan(host);

    await act(async () => button(host, "Připravit brainstorm").click());

    expect(host.textContent).toContain("Uložený tokenový rozsah není dostupný.");
    expect(host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]')).toBeNull();
    expect(button(host, "Spustit fan-out")).toBeUndefined();

    act(() => root.unmount()); host.remove();
  });

  it("offers a healthy live-snapshot model even when the catalog aggregate is unavailable", () => {
    const liveModels: ProviderModels = {
      ...models,
      models: [{
        ...models.models[0]!,
        configured: true,
        observed: true,
        available: false,
        health: ["healthy", "unavailable"],
        source: "mixed",
        provider_routes: [{ provider: "codex_cli", configured: true, observed: true, available: true, health: ["healthy"], source: "mixed", discovery: "usage_probe", reasoning_efforts: ["low", "medium"] }]
      }]
    };
    const { host, root } = mount({ quotas: [quotaFor("codex_cli")], models: liveModels });

    expect([...((host.querySelector('[aria-label="Model codex_cli"]') as HTMLSelectElement).options)].map((option) => option.value)).toEqual(["", "model-x"]);
    act(() => root.unmount()); host.remove();
  });

  it("does not offer a configured static-only model without positive live-snapshot evidence", () => {
    const staticModels: ProviderModels = {
      freshness: "unavailable",
      fetched_at: null,
      next_poll_at: null,
      models: [{
        model_id: "static-only",
        providers: ["codex_cli"],
        configured: true,
        observed: false,
        available: false,
        health: ["unavailable"],
        source: "static_fallback",
        reasoning_efforts: ["low", "medium"],
        provider_routes: [{ provider: "codex_cli", configured: true, observed: false, available: false, health: ["unavailable"], source: "static_fallback", discovery: "static", reasoning_efforts: ["low", "medium"] }]
      }]
    };
    const liveQuota = { ...quotaFor("codex_cli"), models: [] };
    const { host, root } = mount({ quotas: [liveQuota], models: staticModels });

    expect([...((host.querySelector('[aria-label="Model codex_cli"]') as HTMLSelectElement).options)].map((option) => option.value)).toEqual([""]);
    act(() => root.unmount()); host.remove();
  });

  it.each([
    ["stale", { freshness: "stale" as const, health: "healthy" }],
    ["unhealthy", { freshness: "fresh" as const, health: "unavailable" }],
  ])("does not offer live models when the provider snapshot is %s", (_label, state) => {
    const unavailableQuota: ProviderQuota = { ...quotaFor("codex_cli"), ...state };
    const { host, root } = mount({ quotas: [unavailableQuota] });

    expect(host.querySelector('[aria-label="Route codex_cli"]')).toBeNull();
    expect(host.querySelector('[aria-label="Model codex_cli"]')).toBeNull();
    act(() => root.unmount()); host.remove();
  });

  it("renders the heading and a route card per eligible provider with explicit selectors", () => {
    const { host, root } = mount();
    expect(host.querySelector("h2")?.textContent).toBe("Brainstorm");
    for (const provider of ["codex_cli", "claude_cli", "agy_cli"]) {
      expect(host.querySelector(`[aria-label="Model ${provider}"]`)).not.toBeNull();
      expect(host.querySelector(`[aria-label="Reasoning ${provider}"]`)).not.toBeNull();
      expect((host.querySelector(`[aria-label="Model ${provider}"]`) as HTMLSelectElement).value).toBe("");
    }
    expect((host.querySelector('[aria-label="Syntezátor"]') as HTMLSelectElement).value).toBe("");
    act(() => root.unmount()); host.remove();
  });

  it("shows only the minimum-maximum token range and never a USD amount", () => {
    const { host, root } = mount();
    fillFullPlan(host);
    expect(host.textContent).toMatch(/[\d\s ]+–[\d\s ]+ tokenů/);
    expect(host.textContent).not.toContain("USD");
    act(() => root.unmount()); host.remove();
  });

  it("does not dispatch when preparing a draft, and requires the token acknowledgement before enabling fan-out", async () => {
    const { host, root, onCreate, onApprove } = mount();
    fillFullPlan(host);
    expect(button(host, "Spustit fan-out")).toBeUndefined();
    await act(async () => button(host, "Připravit brainstorm").click());
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
    const fanoutButton = button(host, "Spustit fan-out");
    expect(fanoutButton.disabled).toBe(true);
    act(() => (host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]') as HTMLInputElement).click());
    expect(button(host, "Spustit fan-out").disabled).toBe(false);
    await act(async () => button(host, "Spustit fan-out").click());
    expect(onApprove).toHaveBeenCalledWith("bs-1", "cockpit-operator");
    act(() => root.unmount()); host.remove();
  });

  it("invalidates the prepared draft when the brief changes", async () => {
    const { host, root } = mount();
    fillFullPlan(host);
    await act(async () => button(host, "Připravit brainstorm").click());
    act(() => (host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]') as HTMLInputElement).click());
    expect(button(host, "Spustit fan-out").disabled).toBe(false);
    change(host.querySelector('[aria-label="Brief"]')!, "Explore approaches further");
    expect(host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]')).toBeNull();
    expect(button(host, "Spustit fan-out")).toBeUndefined();
    act(() => root.unmount()); host.remove();
  });

  it("invalidates the prepared draft when a route model or reasoning changes", async () => {
    const { host, root } = mount();
    fillFullPlan(host);
    await act(async () => button(host, "Připravit brainstorm").click());
    act(() => (host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]') as HTMLInputElement).click());
    expect(button(host, "Spustit fan-out").disabled).toBe(false);
    change(host.querySelector('[aria-label="Reasoning codex_cli"]') as HTMLSelectElement, "medium");
    expect(host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]')).toBeNull();
    expect(button(host, "Spustit fan-out")).toBeUndefined();
    act(() => root.unmount()); host.remove();
  });

  it("invalidates the prepared draft when the synthesizer changes", async () => {
    const { host, root } = mount();
    fillFullPlan(host);
    await act(async () => button(host, "Připravit brainstorm").click());
    act(() => (host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]') as HTMLInputElement).click());
    expect(button(host, "Spustit fan-out").disabled).toBe(false);
    change(host.querySelector('[aria-label="Syntezátor"]') as HTMLSelectElement, "claude_cli");
    expect(host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]')).toBeNull();
    expect(button(host, "Spustit fan-out")).toBeUndefined();
    act(() => root.unmount()); host.remove();
  });

  it("invalidates the prepared draft when the arbitration route changes", async () => {
    const { host, root } = mount();
    fillFullPlan(host);
    await act(async () => button(host, "Připravit brainstorm").click());
    act(() => (host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]') as HTMLInputElement).click());
    expect(button(host, "Spustit fan-out").disabled).toBe(false);
    change(host.querySelector('[aria-label="Arbitr"]') as HTMLSelectElement, "claude_cli");
    change(host.querySelector('[aria-label="Model arbitra"]') as HTMLSelectElement, "model-x");
    change(host.querySelector('[aria-label="Reasoning arbitra"]') as HTMLSelectElement, "low");
    expect(host.querySelector('[aria-label="Potvrzuji maximální tokenový rozsah"]')).toBeNull();
    expect(button(host, "Spustit fan-out")).toBeUndefined();
    act(() => root.unmount()); host.remove();
  });

  it("disables all mutation controls while a creation is pending and blocks duplicate creation", async () => {
    const pending = deferred<BrainstormRecord>();
    const onCreate = vi.fn(() => pending.promise);
    const { host, root } = mount({ onCreate });
    fillFullPlan(host);
    act(() => { button(host, "Připravit brainstorm").click(); button(host, "Připravit brainstorm").click(); });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(button(host, "Připravit brainstorm").disabled).toBe(true);
    expect((host.querySelector('[aria-label="Brief"]') as HTMLTextAreaElement).disabled).toBe(true);
    expect((host.querySelector('[aria-label="Syntezátor"]') as HTMLSelectElement).disabled).toBe(true);
    await act(async () => pending.resolve(draftRecord));
    act(() => root.unmount()); host.remove();
  });

  it("is DEV-only for mutation and read-only in PROD", () => {
    const { host, root, onCreate } = mount({ environment: "prod" });
    expect(host.querySelector('[aria-label="Brief"]')).toBeNull();
    expect(button(host, "Připravit brainstorm")).toBeUndefined();
    expect(onCreate).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove();
  });

  it("shows precommitted arbiter evidence but no arbitration control or call path in PROD", async () => {
    const record: BrainstormRecord = { ...draftRecord, status: "needs_arbitration", arbitration_route: { provider: "agy_cli", model: "model-x", reasoning_effort: "medium", estimated_tokens: 8_000 }, conflicts: [{ conflict_id: "c1", output_run_ids: ["run-a", "run-b"], summary: "Disagreement", material: true }] };
    const { host, root, onArbitrate } = mount({ environment: "prod", brainstorms: [record] });
    expect(host.textContent).toContain("Předem určený arbitr: agy_cli · model-x");
    expect(button(host, "Vyvolat arbitráž")).toBeUndefined();
    expect(button(host, "Potvrdit arbitráž")).toBeUndefined();
    expect(host.querySelector('[aria-label="Arbitr"]')).toBeNull();
    await act(async () => {}); // flush microtasks
    expect(onArbitrate).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove();
  });

  it("renders labeled child outputs, conflicts, and provenance for an existing brainstorm", () => {
    const runs: readonly RunRecord[] = [{
      schema_version: "v1", current: { run_id: "run-a", revision: 1, project_id: "autopilot-beta", prompt: "Explore approaches", provider: "codex_cli", model: "model-x", estimated_tokens: 100, input_token_bound: 10, output_token_allowance: 90, requested_artifacts: ["text"], profile: "dev", requested_reasoning_effort: "low", promotion_packet_id: null, created_at: quotas[0]!.fetched_at },
      revisions: [], status: "completed", approved_revision: 1, approved_by: "owner", approved_at: quotas[0]!.fetched_at, supervisor_task_id: null, worker_run_id: "wr-a", terminal_reason: null, token_reservation: null, reservation_status: "settled", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [{ artifact_id: "art-1", type: "text", preview: "codex output text", created_at: quotas[0]!.fetched_at }], updated_at: quotas[0]!.fetched_at,
    }];
    const record: BrainstormRecord = { ...draftRecord, status: "completed", child_run_ids: ["run-a"], conflicts: [{ conflict_id: "c1", output_run_ids: ["run-a", "run-a"], summary: "Disagreement on scope", material: true }], final_artifact: "Synthesized answer", consolidation_run_id: "run-consolidate" };
    const { host, root } = mount({ brainstorms: [record], runs });
    expect(host.textContent).toContain("codex_cli · model-x");
    expect(host.textContent).toContain("codex output text");
    expect(host.textContent).toContain("Disagreement on scope");
    expect(host.textContent).toContain("Synthesized answer");
    expect(host.textContent).toContain("run-a, run-consolidate");
    act(() => root.unmount()); host.remove();
  });

  it("requires a second distinct click to cancel a cancellable brainstorm, then calls onCancel", async () => {
    const record: BrainstormRecord = { ...draftRecord, status: "fanout_running" };
    const onCancel = vi.fn().mockResolvedValue({ ...record, status: "cancelled" });
    const { host, root } = mount({ brainstorms: [record], onCancel });
    act(() => button(host, "Zrušit brainstorm").click());
    expect(onCancel).not.toHaveBeenCalled();
    expect(button(host, "Potvrdit zrušení")).not.toBeUndefined();
    await act(async () => button(host, "Potvrdit zrušení").click());
    expect(onCancel).toHaveBeenCalledWith("bs-1");
    act(() => root.unmount()); host.remove();
  });

  it("does not offer cancel for a non-cancellable status, in PROD, or without an onCancel handler", () => {
    const terminal: BrainstormRecord = { ...draftRecord, status: "completed" };
    const cancellable: BrainstormRecord = { ...draftRecord, status: "approved" };
    const withoutHandler = mount({ brainstorms: [cancellable], onCancel: undefined });
    expect(button(withoutHandler.host, "Zrušit brainstorm")).toBeUndefined();
    act(() => withoutHandler.root.unmount()); withoutHandler.host.remove();

    const terminalCase = mount({ brainstorms: [terminal], onCancel: vi.fn() });
    expect(button(terminalCase.host, "Zrušit brainstorm")).toBeUndefined();
    act(() => terminalCase.root.unmount()); terminalCase.host.remove();

    const prodCase = mount({ environment: "prod", brainstorms: [cancellable], onCancel: vi.fn() });
    expect(button(prodCase.host, "Zrušit brainstorm")).toBeUndefined();
    act(() => prodCase.root.unmount()); prodCase.host.remove();
  });

  it("guards against duplicate concurrent cancel clicks and surfaces a cancel error", async () => {
    const record: BrainstormRecord = { ...draftRecord, status: "draft" };
    const pending = deferred<BrainstormRecord>();
    const onCancel = vi.fn().mockReturnValue(pending.promise);
    const { host, root } = mount({ brainstorms: [record], onCancel });
    act(() => button(host, "Zrušit brainstorm").click());
    act(() => button(host, "Potvrdit zrušení").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => button(host, "Potvrdit zrušení")?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error("cancel_failed")); await pending.promise.catch(() => {}); });
    expect(host.textContent).toContain("cancel_failed");
    act(() => root.unmount()); host.remove();
  });

  it("blocks arbitration while a cancel is pending on another brainstorm, then re-enables once cancel settles", async () => {
    const cancellable: BrainstormRecord = { ...draftRecord, brainstorm_id: "bs-cancel", status: "fanout_running" };
    const needsArbitration: BrainstormRecord = { ...draftRecord, brainstorm_id: "bs-arbitrate", status: "needs_arbitration", arbitration_route: { provider: "agy_cli", model: "model-x", reasoning_effort: "medium", estimated_tokens: 8_000 }, conflicts: [{ conflict_id: "c1", output_run_ids: ["run-a", "run-b"], summary: "Disagreement", material: true }] };
    const pending = deferred<BrainstormRecord>();
    const onCancel = vi.fn().mockReturnValue(pending.promise);
    const { host, root, onArbitrate } = mount({ brainstorms: [cancellable, needsArbitration], onCancel });
    act(() => button(host, "Zrušit brainstorm").click());
    act(() => button(host, "Potvrdit zrušení").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    const arbitrateButton = button(host, "Vyvolat arbitráž");
    expect(arbitrateButton.disabled).toBe(true);
    act(() => arbitrateButton.click());
    expect(onArbitrate).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ ...cancellable, status: "cancelled" }); await pending.promise; });
    expect(button(host, "Vyvolat arbitráž").disabled).toBe(false);
    act(() => root.unmount()); host.remove();
  });

  it("blocks cancellation while another mutation (create) is pending", async () => {
    const record: BrainstormRecord = { ...draftRecord, status: "draft" };
    const pending = deferred<BrainstormRecord>();
    const onCreate = vi.fn(() => pending.promise);
    const onCancel = vi.fn().mockResolvedValue({ ...record, status: "cancelled" });
    const { host, root } = mount({ brainstorms: [record], onCreate, onCancel });
    fillFullPlan(host);
    act(() => button(host, "Připravit brainstorm").click());
    expect(onCreate).toHaveBeenCalledTimes(1);
    const cancelButton = button(host, "Zrušit brainstorm");
    expect(cancelButton.disabled).toBe(true);
    act(() => cancelButton.click());
    expect(onCancel).not.toHaveBeenCalled();
    expect(button(host, "Potvrdit zrušení")).toBeUndefined();
    await act(async () => { pending.resolve(draftRecord); await pending.promise; });
    expect(button(host, "Zrušit brainstorm").disabled).toBe(false);
    act(() => root.unmount()); host.remove();
  });

  it("shows only the precommitted arbiter in needs_arbitration and requires a second distinct click to call arbitrate with the stored route", async () => {
    const record: BrainstormRecord = { ...draftRecord, status: "needs_arbitration", arbitration_route: { provider: "agy_cli", model: "model-x", reasoning_effort: "medium", estimated_tokens: 8_000 }, conflicts: [{ conflict_id: "c1", output_run_ids: ["run-a", "run-b"], summary: "Disagreement", material: true }] };
    const { host, root, onArbitrate } = mount({ brainstorms: [record] });
    expect(host.textContent).toContain("Předem určený arbitr: agy_cli · model-x");
    expect(host.querySelector('[aria-label="Arbitr"]')).not.toBeNull();
    act(() => button(host, "Vyvolat arbitráž").click());
    expect(onArbitrate).not.toHaveBeenCalled();
    expect(button(host, "Potvrdit arbitráž")).not.toBeUndefined();
    await act(async () => button(host, "Potvrdit arbitráž").click());
    expect(onArbitrate).toHaveBeenCalledWith("bs-1", "cockpit-operator", { provider: "agy_cli", model: "model-x", reasoning_effort: "medium", estimated_tokens: 8_000 });
    act(() => root.unmount()); host.remove();
  });

  it("requires an explicit no-reasoning selection for a provider with an empty supported list, sending requested_reasoning_effort: null", async () => {
    const { host, root, onCreate } = mount({ quotas: quotasWithOpenrouter, models: modelsWithOpenrouter });
    change(host.querySelector('[aria-label="Brief"]')!, "Explore approaches");
    for (const provider of ["codex_cli", "claude_cli"]) {
      change(host.querySelector(`[aria-label="Model ${provider}"]`) as HTMLSelectElement, "model-x");
      change(host.querySelector(`[aria-label="Reasoning ${provider}"]`) as HTMLSelectElement, "low");
    }
    change(host.querySelector('[aria-label="Model openrouter_api"]') as HTMLSelectElement, "model-x");
    change(host.querySelector('[aria-label="Syntezátor"]') as HTMLSelectElement, "codex_cli");
    change(host.querySelector('[aria-label="Arbitr"]') as HTMLSelectElement, "__opt_out__");
    expect(button(host, "Připravit brainstorm").disabled).toBe(true);

    const reasoningSelect = host.querySelector('[aria-label="Reasoning openrouter_api"]') as HTMLSelectElement;
    expect([...reasoningSelect.options].map((option) => option.value)).not.toContain("low");
    expect([...reasoningSelect.options].some((option) => option.value === "__no_reasoning__")).toBe(true);

    change(reasoningSelect, "__no_reasoning__");
    expect(button(host, "Připravit brainstorm").disabled).toBe(false);
    await act(async () => button(host, "Připravit brainstorm").click());
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      routes: expect.arrayContaining([expect.objectContaining({ provider: "openrouter_api", requested_reasoning_effort: null })]),
    }));
    act(() => root.unmount()); host.remove();
  });

  it("filters route cards to known RunProvider values, excluding unknown providers", () => {
    const { host, root } = mount({ quotas: [...quotas, quotaFor("some_unknown_provider")] });
    expect(host.querySelector('[aria-label="Route some_unknown_provider"]')).toBeNull();
    expect(host.querySelectorAll(".brainstorm-route-card").length).toBe(3);
    act(() => root.unmount()); host.remove();
  });

  it("shows a pre-create token range matching the server canonical allocation, and validates against the returned stored envelope after create", async () => {
    const { host, root, onCreate } = mount();
    fillFullPlan(host);
    const briefTokens = new TextEncoder().encode("Explore approaches").length;
    const perRoute = briefTokens + 8_192;
    const fanoutTokens = perRoute * 3;
    const maximumTokens = fanoutTokens + 10_000;
    const minimumTokens = maximumTokens;
    expect(host.textContent).toContain(`${minimumTokens.toLocaleString("cs-CZ")}–${maximumTokens.toLocaleString("cs-CZ")} tokenů`);

    const envelope = { fanout_tokens: fanoutTokens, consolidation_tokens: 10_000, optional_arbitration_tokens: 0, minimum_tokens: minimumTokens, maximum_tokens: maximumTokens };
    onCreate.mockResolvedValueOnce({ ...draftRecord, token_envelope: envelope });
    await act(async () => button(host, "Připravit brainstorm").click());
    expect(host.textContent).toContain(`${minimumTokens.toLocaleString("cs-CZ")}–${maximumTokens.toLocaleString("cs-CZ")} tokenů`);
    act(() => root.unmount()); host.remove();
  });

  it("computes the arbitration-inclusive minimum as maximum minus floor(maximum/(routeCount+2))", () => {
    const { host, root } = mount();
    fillFullPlan(host);
    change(host.querySelector('[aria-label="Arbitr"]') as HTMLSelectElement, "claude_cli");
    change(host.querySelector('[aria-label="Model arbitra"]') as HTMLSelectElement, "model-x");
    change(host.querySelector('[aria-label="Reasoning arbitra"]') as HTMLSelectElement, "low");
    const briefTokens = new TextEncoder().encode("Explore approaches").length;
    const perRoute = briefTokens + 8_192;
    const fanoutTokens = perRoute * 3;
    const maximumTokens = fanoutTokens + 10_000 + 8_000;
    const minimumTokens = maximumTokens - Math.floor(maximumTokens / (3 + 2));
    expect(host.textContent).toContain(`${minimumTokens.toLocaleString("cs-CZ")}–${maximumTokens.toLocaleString("cs-CZ")} tokenů`);
    act(() => root.unmount()); host.remove();
  });

  it("renders consensus bullets and confidence percentage parsed from the consolidation run's output", () => {
    const runs: readonly RunRecord[] = [{
      schema_version: "v1", current: { run_id: "run-consolidate", revision: 1, project_id: "autopilot-beta", prompt: "consolidate", provider: "codex_cli", model: "model-x", estimated_tokens: 100, input_token_bound: 10, output_token_allowance: 90, requested_artifacts: ["text"], profile: "dev", requested_reasoning_effort: "low", promotion_packet_id: null, created_at: quotas[0]!.fetched_at },
      revisions: [], status: "completed", approved_revision: 1, approved_by: "owner", approved_at: quotas[0]!.fetched_at, supervisor_task_id: null, worker_run_id: "wr-c", terminal_reason: null, token_reservation: null, reservation_status: "settled",
      provider_result: { refused: false, reason: null, worker_run_id: "wr-c", raw_output: JSON.stringify({ consensus: ["Agree on scope", "Agree on approach"], confidence: 0.82, final: "x", conflicts: [] }), exit_code: 0, error_reason: null, lock_status: "acquired_supervisor_spawn" },
      cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: quotas[0]!.fetched_at,
    }];
    const record: BrainstormRecord = { ...draftRecord, status: "completed", consolidation_run_id: "run-consolidate", final_artifact: "x" };
    const { host, root } = mount({ brainstorms: [record], runs });
    expect(host.textContent).toContain("Agree on scope");
    expect(host.textContent).toContain("Agree on approach");
    expect(host.textContent).toContain("82 %");
    act(() => root.unmount()); host.remove();
  });

  it("falls back to unavailable for consensus and confidence when the consolidation output is malformed or unbounded", () => {
    const runs: readonly RunRecord[] = [{
      schema_version: "v1", current: { run_id: "run-consolidate", revision: 1, project_id: "autopilot-beta", prompt: "consolidate", provider: "codex_cli", model: "model-x", estimated_tokens: 100, input_token_bound: 10, output_token_allowance: 90, requested_artifacts: ["text"], profile: "dev", requested_reasoning_effort: "low", promotion_packet_id: null, created_at: quotas[0]!.fetched_at },
      revisions: [], status: "completed", approved_revision: 1, approved_by: "owner", approved_at: quotas[0]!.fetched_at, supervisor_task_id: null, worker_run_id: "wr-c", terminal_reason: null, token_reservation: null, reservation_status: "settled",
      provider_result: { refused: false, reason: null, worker_run_id: "wr-c", raw_output: "not json at all {", exit_code: 0, error_reason: null, lock_status: "acquired_supervisor_spawn" },
      cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: quotas[0]!.fetched_at,
    }];
    const record: BrainstormRecord = { ...draftRecord, status: "completed", consolidation_run_id: "run-consolidate", final_artifact: "x" };
    const { host, root } = mount({ brainstorms: [record], runs });
    expect(host.textContent).toContain("Konsenzus nedostupný");
    expect(host.textContent).toContain("Jistota nedostupná");
    act(() => root.unmount()); host.remove();
  });
});
