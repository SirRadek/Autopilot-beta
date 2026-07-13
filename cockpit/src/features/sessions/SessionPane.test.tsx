import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { SessionRecord } from "../../types/controlPlane";
import { SessionPane } from "./SessionPane";

const session: SessionRecord = { session_id: "s-1", agent_command: "claude_cli", cwd: "/work/alpha", name: "Manager", status: "active", created_at: "2026-07-11T09:00:00.000Z", updated_at: "2026-07-11T09:00:00.000Z", owner_expires_at: "2026-07-11T10:00:00.000Z", queue: [] };
const expired: SessionRecord = { ...session, session_id: "s-2", name: "Expired", owner_expires_at: "2026-07-11T08:00:00.000Z" };

describe("SessionPane", () => {
  it("renders empty state and create action", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const create = () => undefined;
    act(() => { root.render(<SessionPane sessions={[]} onCreate={create} />); });
    expect(host.textContent).toContain("No projects or sessions");
    expect(host.querySelector("button")?.getAttribute("aria-label")).toContain("Create session");
    act(() => root.unmount()); host.remove();
  });

  it("supports select, resume, close, and bounded project/session labels", () => {
    const calls: string[] = []; const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => { root.render(<SessionPane sessions={[session, expired]} now={new Date("2026-07-11T09:30:00.000Z")} selectedSessionId="s-1" onSelect={(value) => calls.push(`select:${value.session_id}`)} onResume={(value) => calls.push(`resume:${value.session_id}`)} onClose={(value) => calls.push(`close:${value.session_id}`)} onCreate={() => calls.push("create")} />); });
    expect(host.textContent).toContain("alpha"); expect(host.textContent).toContain("Manager");
    expect(host.querySelector("[aria-current='true']")).not.toBeNull();
    const click = (prefix: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label")?.startsWith(prefix))?.click();
    act(() => { click("Select"); }); act(() => { click("Resume"); }); act(() => { click("Close"); }); act(() => { click("Create session for"); });
    expect(calls).toEqual(["select:s-1", "resume:s-2", "close:s-1", "create"]);
    act(() => root.unmount()); host.remove();
  });
});
