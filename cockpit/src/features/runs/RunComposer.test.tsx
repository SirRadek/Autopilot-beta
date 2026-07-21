import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { ProjectEntry, ProviderModels, ProviderQuota, RunRecord } from "../../types/controlPlane";
import { RunComposer } from "./RunComposer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const projects: readonly ProjectEntry[] = [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: "/private/not-submitted", enabled: true }];
const quota: ProviderQuota = { provider: "codex_cli", source: "cli", fetched_at: "2026-07-13T10:00:00.000Z", observed_at: "2026-07-13T10:00:00.000Z", five_hour: { limit: 1000, used: 200, remaining: 800, resets_at: null }, weekly: { limit: 5000, used: 1000, remaining: 4000, resets_at: null }, api_spend: 1.25, currency: "USD", models: [{ model_id: "gpt-5", available: true, health: "healthy", source: "cli" }], health: "healthy", error_code: null, freshness: "fresh", next_poll_at: null };
const models: ProviderModels = { freshness: "fresh", fetched_at: quota.fetched_at, next_poll_at: null, models: [{ model_id: "gpt-5", providers: ["codex_cli"], available: true, health: ["healthy"], reasoning_efforts: ["low", "medium", "high"], provider_routes: [{ provider: "codex_cli", reasoning_efforts: ["low", "medium", "high"] }] }] };
const prepared: RunRecord = {
  schema_version: "v1",
  current: { run_id: "run-1", revision: 1, project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: "gpt-5", estimated_tokens: 8_206, input_token_bound: 14, output_token_allowance: 8_192, requested_artifacts: ["text"], prompt_review_acknowledged: false, profile: "dev", requested_reasoning_effort: "low", promotion_packet_id: null, created_at: quota.fetched_at },
  revisions: [], status: "draft", approved_revision: null, approved_by: null, approved_at: null, supervisor_task_id: null, worker_run_id: null, terminal_reason: null, token_reservation: null, reservation_status: "none", provider_result: null, cancellation_requested: false, queue_compensation_requested: false, dispatch_failure: null, retry_input_tokens: 0, retry_output_tokens: 0, artifacts: [], updated_at: quota.fetched_at,
};

function mount(overrides: Partial<React.ComponentProps<typeof RunComposer>> = {}) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const onPrepare = vi.fn(async (input) => ({ ...prepared, current: { ...prepared.current, ...input } })); const onApprove = vi.fn().mockResolvedValue(prepared);
  act(() => root.render(<RunComposer projects={projects} quotas={[quota]} models={models} onPrepare={onPrepare} onApprove={onApprove} {...overrides} />));
  return { host, root, onPrepare, onApprove };
}

function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string | boolean) { act(() => { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), typeof value === "boolean" ? "checked" : "value")?.set; setter?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement || typeof value === "boolean" ? "change" : "input", { bubbles: true })); }); }
function button(host: HTMLElement, text: string) { return [...host.querySelectorAll("button")].find((item) => item.textContent === text) as HTMLButtonElement; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function makeRunComposerProps(overrides: { readonly reasoning_efforts?: readonly ("low" | "medium" | "high" | "xhigh" | "max")[] } = {}): React.ComponentProps<typeof RunComposer> & { readonly onPrepare: ReturnType<typeof vi.fn> } {
  const reasoningEfforts = overrides.reasoning_efforts ?? ["low", "medium", "high"];
  const scopedModels: ProviderModels = { freshness: "fresh", fetched_at: quota.fetched_at, next_poll_at: null, models: [{ model_id: "gpt-5", providers: ["codex_cli"], available: true, health: ["healthy"], reasoning_efforts: reasoningEfforts, provider_routes: [{ provider: "codex_cli", reasoning_efforts: reasoningEfforts }] }] };
  const onPrepare = vi.fn(async (input) => ({ ...prepared, current: { ...prepared.current, ...input } }));
  const onApprove = vi.fn().mockResolvedValue(prepared);
  return { projects, quotas: [quota], models: scopedModels, onPrepare, onApprove };
}

describe("RunComposer", () => {
  it("adopts the first allowlisted route when cockpit data arrives asynchronously", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<RunComposer projects={[]} quotas={[]} onPrepare={vi.fn()} onApprove={vi.fn()} />));
    act(() => root.render(<RunComposer projects={projects} quotas={[quota]} models={models} onPrepare={vi.fn()} onApprove={vi.fn()} />));
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    expect((host.querySelector('[aria-label="Projekt"]') as HTMLSelectElement).value).toBe("autopilot-beta");
    expect((host.querySelector('[aria-label="Poskytovatel"]') as HTMLSelectElement).value).toBe("codex_cli");
    expect((host.querySelector('[aria-label="Model"]') as HTMLSelectElement).value).toBe("gpt-5");
    expect(button(host, "Připravit běh").disabled).toBe(false);
    act(() => root.unmount()); host.remove();
  });

  it("prepares separately, displays governance estimates, and approves the displayed revision", async () => {
    const { host, root, onPrepare, onApprove } = mount();
    change(host.querySelector('[aria-label="Projekt"]')!, "autopilot-beta");
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    expect(host.textContent).toContain("200 / 1,000"); expect(host.textContent).toContain("1.25 USD"); expect(host.textContent).toContain("Odhad tokenů: 8,206");
    act(() => (host.querySelector('[aria-label="Vizuální výstup"]') as HTMLInputElement).click());
    await act(async () => button(host, "Připravit běh").click());
    expect(onPrepare).toHaveBeenCalledWith({ project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: "gpt-5", estimated_tokens: 8_206, requested_artifacts: ["text", "visual"], requested_reasoning_effort: "low" });
    expect(onApprove).not.toHaveBeenCalled(); expect(button(host, "Schválit a spustit").disabled).toBe(false);
    await act(async () => button(host, "Schválit a spustit").click());
    expect(onApprove).toHaveBeenCalledWith("run-1", 1);
    act(() => root.unmount()); host.remove();
  });

  it("disables stale and unavailable routes and warns explicitly", () => {
    const stale = { ...quota, freshness: "stale" as const };
    const { host, root } = mount({ quotas: [stale], models: { ...models, freshness: "stale" } });
    expect(host.textContent).toContain("Data poskytovatele nejsou aktuální");
    expect(button(host, "Připravit běh").disabled).toBe(true);
    expect((host.querySelector('[aria-label="Poskytovatel"]') as HTMLSelectElement).options[0]?.disabled).toBe(true);
    act(() => root.unmount()); host.remove();
  });

  it("prepares a fresh, healthy selected route when an unrelated provider is unavailable", () => {
    // Mirrors production: the control plane only aggregates catalog freshness to
    // "unavailable" because a sibling provider (claude_cli) is unavailable, yet the
    // selected route (codex_cli) is fresh and healthy. Server-side isRunRouteEligible
    // scopes eligibility to the selected provider, so the composer must not block it.
    const unavailableSibling: ProviderQuota = { ...quota, provider: "claude_cli", health: "unavailable", freshness: "unavailable", models: [] };
    const { host, root } = mount({ quotas: [quota, unavailableSibling], models: { ...models, freshness: "unavailable" } });
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    expect((host.querySelector('[aria-label="Poskytovatel"]') as HTMLSelectElement).value).toBe("codex_cli");
    expect(host.textContent).not.toContain("Data poskytovatele nejsou aktuální");
    expect(button(host, "Připravit běh").disabled).toBe(false);
    act(() => root.unmount()); host.remove();
  });

  it("invalidates shown approval when any draft field changes", async () => {
    const { host, root } = mount(); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    await act(async () => button(host, "Připravit běh").click());
    expect(button(host, "Schválit a spustit").disabled).toBe(false);
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect changed status");
    expect(button(host, "Schválit a spustit").disabled).toBe(true); expect(host.textContent).not.toContain("Revize 1 připravena ke schválení");
    act(() => root.unmount()); host.remove();
  });

  it("does not accept a pending prepare after the draft is edited", async () => {
    const pending = deferred<RunRecord>(); const onPrepare = vi.fn(() => pending.promise);
    const { host, root } = mount({ onPrepare }); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    act(() => button(host, "Připravit běh").click());
    expect(button(host, "Připravit běh").disabled).toBe(true); expect(host.textContent).toContain("Příprava běhu…");
    change(host.querySelector('[aria-label="Prompt"]')!, "Changed while pending");
    await act(async () => pending.resolve(prepared));
    expect(button(host, "Schválit a spustit").disabled).toBe(true); expect(host.textContent).not.toContain("Revize 1 připravena");
    act(() => root.unmount()); host.remove();
  });

  it("ignores out-of-order prepare results and accepts only the latest bound draft", async () => {
    const first = deferred<RunRecord>(); const second = deferred<RunRecord>(); const onPrepare = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { host, root, onApprove } = mount({ onPrepare }); change(host.querySelector('[aria-label="Prompt"]')!, "First"); act(() => button(host, "Připravit běh").click());
    change(host.querySelector('[aria-label="Prompt"]')!, "Second"); act(() => button(host, "Připravit běh").click());
    const secondRun = { ...prepared, current: { ...prepared.current, run_id: "run-2", revision: 2, prompt: "Second", estimated_tokens: 8_198 } };
    await act(async () => second.resolve(secondRun)); await act(async () => first.resolve({ ...prepared, current: { ...prepared.current, prompt: "First", estimated_tokens: 8_197 } }));
    expect(host.textContent).toContain("Revize 2 připravena"); await act(async () => button(host, "Schválit a spustit").click());
    expect(onApprove).toHaveBeenCalledWith("run-2", 2);
    act(() => root.unmount()); host.remove();
  });

  it("requires a healthy provider and a model available in both quota and catalog", () => {
    const unavailable = { ...quota, health: "unavailable" };
    const first = mount({ quotas: [unavailable] }); change(first.host.querySelector('[aria-label="Prompt"]')!, "Inspect"); expect(button(first.host, "Připravit běh").disabled).toBe(true); act(() => first.root.unmount()); first.host.remove();
    const second = mount({ quotas: [{ ...quota, models: [] }], models: { ...models, models: [] } }); change(second.host.querySelector('[aria-label="Prompt"]')!, "Inspect"); expect(button(second.host, "Připravit běh").disabled).toBe(true); act(() => second.root.unmount()); second.host.remove();
    const third = mount({ models: { ...models, models: [{ ...models.models[0]!, available: false }] } }); change(third.host.querySelector('[aria-label="Prompt"]')!, "Inspect"); expect(button(third.host, "Připravit běh").disabled).toBe(true); act(() => third.root.unmount()); third.host.remove();
  });

  it("invalidates a prepared revision when refreshed route props change", async () => {
    const { host, root, onPrepare, onApprove } = mount(); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status"); await act(async () => button(host, "Připravit běh").click());
    const changedModels = { ...models, models: [{ model_id: "gpt-6", providers: ["codex_cli"], available: true, health: ["healthy"] }] };
    const changedQuota = { ...quota, models: [{ model_id: "gpt-6", available: true, health: "healthy", source: "cli" }] };
    act(() => root.render(<RunComposer projects={projects} quotas={[changedQuota]} models={changedModels} onPrepare={onPrepare} onApprove={onApprove} />));
    expect((host.querySelector('[aria-label="Model"]') as HTMLSelectElement).value).toBe("gpt-6"); expect(button(host, "Schválit a spustit").disabled).toBe(true);
    act(() => root.unmount()); host.remove();
  });

  it("blocks duplicate actions and reports callback errors accessibly", async () => {
    const prepare = deferred<RunRecord>(); const onPrepare = vi.fn(() => prepare.promise); const { host, root } = mount({ onPrepare }); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect");
    act(() => { button(host, "Připravit běh").click(); button(host, "Připravit běh").click(); }); expect(onPrepare).toHaveBeenCalledTimes(1);
    await act(async () => prepare.reject(new Error("route failed"))); expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain("route failed");
    act(() => root.unmount()); host.remove();
  });

  it("blocks duplicate approvals and reports approval errors", async () => {
    const approval = deferred<RunRecord>(); const onApprove = vi.fn(() => approval.promise); const { host, root } = mount({ onApprove }); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status"); await act(async () => button(host, "Připravit běh").click());
    act(() => { button(host, "Schválit a spustit").click(); button(host, "Schválit a spustit").click(); });
    expect(onApprove).toHaveBeenCalledTimes(1); expect(button(host, "Schválit a spustit").disabled).toBe(true); expect(host.textContent).toContain("Schvalování běhu…");
    await act(async () => approval.reject(new Error("approval failed"))); expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain("approval failed");
    act(() => root.unmount()); host.remove();
  });

  it("rejects a server prepare response whose bound fields do not match", async () => {
    const onPrepare = vi.fn().mockResolvedValue({ ...prepared, current: { ...prepared.current, model: "other-model" } }); const { host, root } = mount({ onPrepare }); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    await act(async () => button(host, "Připravit běh").click()); expect(button(host, "Schválit a spustit").disabled).toBe(true); expect(host.textContent).not.toContain("připravena ke schválení");
    act(() => root.unmount()); host.remove();
  });

  it("invalidates and blocks preparation when the selected project is removed or disabled", async () => {
    const { host, root, onPrepare, onApprove } = mount(); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status"); await act(async () => button(host, "Připravit běh").click());
    act(() => root.render(<RunComposer projects={[]} quotas={[quota]} models={models} onPrepare={onPrepare} onApprove={onApprove} />));
    expect(button(host, "Připravit běh").disabled).toBe(true); expect(button(host, "Schválit a spustit").disabled).toBe(true);
    act(() => root.render(<RunComposer projects={[{ ...projects[0]!, enabled: false }]} quotas={[quota]} models={models} onPrepare={onPrepare} onApprove={onApprove} />));
    expect(button(host, "Připravit běh").disabled).toBe(true); act(() => root.unmount()); host.remove();
  });

  it("consumes a prepared revision after successful approval", async () => {
    const { host, root, onApprove } = mount(); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status"); await act(async () => button(host, "Připravit běh").click());
    await act(async () => button(host, "Schválit a spustit").click()); expect(button(host, "Schválit a spustit").disabled).toBe(true);
    act(() => button(host, "Schválit a spustit").click()); expect(onApprove).toHaveBeenCalledTimes(1); act(() => root.unmount()); host.remove();
  });

  it("does not let a stale rejection overwrite status after an edit", async () => {
    const pending = deferred<RunRecord>(); const { host, root } = mount({ onPrepare: vi.fn(() => pending.promise) }); change(host.querySelector('[aria-label="Prompt"]')!, "First"); act(() => button(host, "Připravit běh").click());
    change(host.querySelector('[aria-label="Prompt"]')!, "Second"); await act(async () => pending.reject(new Error("obsolete failure")));
    expect(host.querySelector('[aria-live="polite"]')?.textContent).not.toContain("obsolete failure"); act(() => root.unmount()); host.remove();
  });

  it("exposes only server-advertised reasoning efforts, binds the owner's choice, and shows the static shadow-only label", async () => {
    const runComposerProps = makeRunComposerProps({ reasoning_efforts: ["low", "medium", "high"] });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<RunComposer {...runComposerProps} />));
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    const reasoningSelect = host.querySelector('[aria-label="Reasoning"]') as HTMLSelectElement;
    expect([...reasoningSelect.options].map((option) => option.value)).toEqual(["low", "medium", "high"]);
    change(reasoningSelect, "high");
    await act(async () => button(host, "Připravit běh").click());
    expect(runComposerProps.onPrepare).toHaveBeenCalledWith(expect.objectContaining({ requested_reasoning_effort: "high" }));
    expect(host.textContent).toContain("Doporučení: žádné (shadow-only)");
    act(() => root.unmount()); host.remove();
  });

  it("clears an invalid reasoning effort and invalidates any prepared draft when the provider or model changes", async () => {
    const runComposerProps = makeRunComposerProps({ reasoning_efforts: ["low", "medium", "high"] });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<RunComposer {...runComposerProps} />));
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    change(host.querySelector('[aria-label="Reasoning"]') as HTMLSelectElement, "high");
    await act(async () => button(host, "Připravit běh").click());
    expect(button(host, "Schválit a spustit").disabled).toBe(false);
    const narrowedModels: ProviderModels = { freshness: "fresh", fetched_at: quota.fetched_at, next_poll_at: null, models: [{ model_id: "gpt-5", providers: ["codex_cli"], available: true, health: ["healthy"], reasoning_efforts: ["low"], provider_routes: [{ provider: "codex_cli", reasoning_efforts: ["low"] }] }] };
    act(() => root.render(<RunComposer {...runComposerProps} models={narrowedModels} />));
    expect(button(host, "Schválit a spustit").disabled).toBe(true);
    expect((host.querySelector('[aria-label="Reasoning"]') as HTMLSelectElement).value).toBe("low");
    act(() => root.unmount()); host.remove();
  });

  it("fails closed to no reasoning options when the provider route advertises none", () => {
    const runComposerProps = makeRunComposerProps({ reasoning_efforts: [] });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<RunComposer {...runComposerProps} />));
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    const reasoningSelect = host.querySelector('[aria-label="Reasoning"]') as HTMLSelectElement;
    expect(reasoningSelect.options.length).toBe(0);
    expect(button(host, "Připravit běh").disabled).toBe(true);
    act(() => button(host, "Připravit běh").click());
    expect(runComposerProps.onPrepare).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove();
  });

  it("does not fall back to aggregate efforts when the exact provider route is missing", () => {
    const runComposerProps = makeRunComposerProps();
    const missingRoute: ProviderModels = { freshness: "fresh", fetched_at: quota.fetched_at, next_poll_at: null, models: [{ model_id: "gpt-5", providers: ["codex_cli"], available: true, health: ["healthy"], reasoning_efforts: ["low", "medium", "high"] }] };
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<RunComposer {...runComposerProps} models={missingRoute} />));
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    expect((host.querySelector('[aria-label="Reasoning"]') as HTMLSelectElement).options.length).toBe(0);
    expect(button(host, "Připravit běh").disabled).toBe(true);
    act(() => button(host, "Připravit běh").click());
    expect(runComposerProps.onPrepare).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove();
  });

  it("uses the exact provider route for a model shared by multiple providers", () => {
    const claudeQuota: ProviderQuota = { ...quota, provider: "claude_cli", models: [{ model_id: "gpt-5", available: true, health: "healthy", source: "cli" }] };
    const sharedModels: ProviderModels = { freshness: "fresh", fetched_at: quota.fetched_at, next_poll_at: null, models: [{ model_id: "gpt-5", providers: ["codex_cli", "claude_cli"], available: true, health: ["healthy"], reasoning_efforts: ["low"], provider_routes: [{ provider: "codex_cli", reasoning_efforts: ["low"] }, { provider: "claude_cli", reasoning_efforts: ["high", "max"] }] }] };
    const { host, root } = mount({ quotas: [quota, claudeQuota], models: sharedModels });
    expect([...((host.querySelector('[aria-label="Reasoning"]') as HTMLSelectElement).options)].map((option) => option.value)).toEqual(["low"]);
    change(host.querySelector('[aria-label="Poskytovatel"]') as HTMLSelectElement, "claude_cli");
    expect([...((host.querySelector('[aria-label="Reasoning"]') as HTMLSelectElement).options)].map((option) => option.value)).toEqual(["high", "max"]);
    act(() => root.unmount()); host.remove();
  });

  it("rejects non-draft prepare responses with an accessible stable error", async () => {
    const onPrepare = vi.fn(async (input) => ({ ...prepared, status: "queued" as const, current: { ...prepared.current, ...input } })); const { host, root } = mount({ onPrepare }); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    await act(async () => button(host, "Připravit běh").click()); expect(button(host, "Schválit a spustit").disabled).toBe(true); expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain("neplatný stav");
    act(() => root.unmount()); host.remove();
  });
});
