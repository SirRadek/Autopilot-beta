import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { ProjectEntry, ProviderModels, ProviderQuota, RunRecord } from "../../types/controlPlane";
import { RunComposer } from "./RunComposer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const projects: readonly ProjectEntry[] = [{ schema_version: "v1", project_id: "autopilot-beta", name: "Autopilot Beta", cwd: "/private/not-submitted", enabled: true }];
const quota: ProviderQuota = { provider: "codex_cli", source: "cli", fetched_at: "2026-07-13T10:00:00.000Z", observed_at: "2026-07-13T10:00:00.000Z", five_hour: { limit: 1000, used: 200, remaining: 800, resets_at: null }, weekly: { limit: 5000, used: 1000, remaining: 4000, resets_at: null }, api_spend: 1.25, currency: "USD", models: [{ model_id: "gpt-5", available: true, health: "healthy", source: "cli" }], health: "healthy", error_code: null, freshness: "fresh", next_poll_at: null };
const models: ProviderModels = { freshness: "fresh", fetched_at: quota.fetched_at, next_poll_at: null, models: [{ model_id: "gpt-5", providers: ["codex_cli"], available: true, health: ["healthy"] }] };
const prepared = { status: "draft", current: { run_id: "run-1", revision: 1, project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: "gpt-5", estimated_tokens: 4, requested_artifacts: ["text"], created_at: quota.fetched_at } } as RunRecord;

function mount(overrides: Partial<React.ComponentProps<typeof RunComposer>> = {}) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const onPrepare = vi.fn(async (input) => ({ ...prepared, current: { ...prepared.current, ...input } })); const onApprove = vi.fn().mockResolvedValue(prepared);
  act(() => root.render(<RunComposer projects={projects} quotas={[quota]} models={models} onPrepare={onPrepare} onApprove={onApprove} {...overrides} />));
  return { host, root, onPrepare, onApprove };
}

function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string | boolean) { act(() => { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), typeof value === "boolean" ? "checked" : "value")?.set; setter?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement || typeof value === "boolean" ? "change" : "input", { bubbles: true })); }); }
function button(host: HTMLElement, text: string) { return [...host.querySelectorAll("button")].find((item) => item.textContent === text) as HTMLButtonElement; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe("RunComposer", () => {
  it("prepares separately, displays governance estimates, and approves the displayed revision", async () => {
    const { host, root, onPrepare, onApprove } = mount();
    change(host.querySelector('[aria-label="Projekt"]')!, "autopilot-beta");
    change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    expect(host.textContent).toContain("200 / 1,000"); expect(host.textContent).toContain("1.25 USD"); expect(host.textContent).toContain("Odhad tokenů: 4");
    act(() => (host.querySelector('[aria-label="Vizuální výstup"]') as HTMLInputElement).click());
    await act(async () => button(host, "Připravit běh").click());
    expect(onPrepare).toHaveBeenCalledWith({ project_id: "autopilot-beta", prompt: "Inspect status", provider: "codex_cli", model: "gpt-5", estimated_tokens: 4, requested_artifacts: ["text", "visual"] });
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
    const secondRun = { ...prepared, current: { ...prepared.current, run_id: "run-2", revision: 2, prompt: "Second", estimated_tokens: 2 } };
    await act(async () => second.resolve(secondRun)); await act(async () => first.resolve({ ...prepared, current: { ...prepared.current, prompt: "First", estimated_tokens: 2 } }));
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

  it("rejects non-draft prepare responses with an accessible stable error", async () => {
    const onPrepare = vi.fn(async (input) => ({ ...prepared, status: "queued" as const, current: { ...prepared.current, ...input } })); const { host, root } = mount({ onPrepare }); change(host.querySelector('[aria-label="Prompt"]')!, "Inspect status");
    await act(async () => button(host, "Připravit běh").click()); expect(button(host, "Schválit a spustit").disabled).toBe(true); expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain("neplatný stav");
    act(() => root.unmount()); host.remove();
  });
});
