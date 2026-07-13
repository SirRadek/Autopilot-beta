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
  const onPrepare = vi.fn().mockResolvedValue(prepared); const onApprove = vi.fn().mockResolvedValue(prepared);
  act(() => root.render(<RunComposer projects={projects} quotas={[quota]} models={models} onPrepare={onPrepare} onApprove={onApprove} {...overrides} />));
  return { host, root, onPrepare, onApprove };
}

function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string | boolean) { act(() => { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), typeof value === "boolean" ? "checked" : "value")?.set; setter?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement || typeof value === "boolean" ? "change" : "input", { bubbles: true })); }); }
function button(host: HTMLElement, text: string) { return [...host.querySelectorAll("button")].find((item) => item.textContent === text) as HTMLButtonElement; }

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
});
