import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { SessionRecord } from "../../types/controlPlane";
import { SessionPane } from "./SessionPane";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const session: SessionRecord = { session_id: "s-1", agent_command: "claude_cli", cwd: "/work/alpha", name: "Manager", status: "active", created_at: "2026-07-11T09:00:00.000Z", updated_at: "2026-07-11T09:00:00.000Z", owner_expires_at: "2026-07-11T10:00:00.000Z", queue: [] };
const expired: SessionRecord = { ...session, session_id: "s-2", name: "Expired", owner_expires_at: "2026-07-11T08:00:00.000Z" };

function changeInput(element: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function changeSelect(element: HTMLSelectElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("SessionPane", () => {
  it("renders empty state and create action", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const create = () => undefined;
    act(() => { root.render(<SessionPane sessions={[]} onCreate={create} />); });
    expect(host.textContent).toContain("Žádné projekty ani relace");
    expect(host.textContent).toContain("0 relací");
    expect(host.querySelector("button")?.getAttribute("aria-label")).toContain("Vytvořit relaci");
    act(() => root.unmount()); host.remove();
  });

  it("supports select, resume, close, and bounded project/session labels", () => {
    const calls: string[] = []; const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => { root.render(<SessionPane sessions={[session, expired]} now={new Date("2026-07-11T09:30:00.000Z")} selectedSessionId="s-1" onSelect={(value) => calls.push(`select:${value.session_id}`)} onResume={(value) => calls.push(`resume:${value.session_id}`)} onClose={(value) => calls.push(`close:${value.session_id}`)} onCreate={(provider, cwd) => { calls.push(`create:${provider}:${cwd}`); }} />); });
    expect(host.textContent).toContain("alpha"); expect(host.textContent).toContain("Manager"); expect(host.textContent).toContain("2 relace"); expect(host.textContent).toContain("Aktivní"); expect(host.textContent).toContain("Vypršela");
    expect(host.querySelector("[aria-current='true']")).not.toBeNull();
    const click = (prefix: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label")?.startsWith(prefix))?.click();
    act(() => { click("Vybrat relaci"); }); act(() => { click("Obnovit relaci"); }); act(() => { click("Zavřít relaci"); }); act(() => { click("Vytvořit relaci pro"); });
    expect(calls).toEqual(["select:s-1", "resume:s-2", "close:s-1", "create:claude_cli:/work/alpha"]);
    act(() => root.unmount()); host.remove();
  });

  it("offers every known provider and prefers one with a currently active session", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => { root.render(<SessionPane sessions={[]} now={new Date("2026-07-11T09:30:00.000Z")} />); });

    const provider = host.querySelector<HTMLSelectElement>("#session-provider")!;
    expect([...provider.options].map((option) => option.value)).toEqual(["codex_cli", "claude_cli", "agy_cli", "openrouter_api"]);
    expect(provider.value).toBe("codex_cli");

    act(() => { root.render(<SessionPane sessions={[expired, session]} now={new Date("2026-07-11T09:30:00.000Z")} />); });
    expect(host.querySelector<HTMLSelectElement>("#session-provider")?.value).toBe("claude_cli");

    act(() => root.unmount()); host.remove();
  });

  it("defaults to the first known provider when no session is currently active", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => { root.render(<SessionPane sessions={[expired]} now={new Date("2026-07-11T09:30:00.000Z")} />); });

    expect(host.querySelector<HTMLSelectElement>("#session-provider")?.value).toBe("codex_cli");

    act(() => root.unmount()); host.remove();
  });

  it("creates a session with the selected provider and entered cwd", async () => {
    const create = vi.fn(async () => undefined);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => { root.render(<SessionPane sessions={[session]} now={new Date("2026-07-11T09:30:00.000Z")} onCreate={create} />); });
    changeSelect(host.querySelector<HTMLSelectElement>("#session-provider")!, "openrouter_api");
    changeInput(host.querySelector<HTMLInputElement>("#session-cwd")!, "/work/openrouter");

    await act(async () => { host.querySelector<HTMLFormElement>(".session-create")?.requestSubmit(); });

    expect(create).toHaveBeenCalledWith("openrouter_api", "/work/openrouter");
    act(() => root.unmount()); host.remove();
  });
});
