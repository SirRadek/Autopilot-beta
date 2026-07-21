import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axe from "axe-core";
import { renderToStaticMarkup } from "react-dom/server";

import { AppShell } from "./AppShell";
import type { CockpitEnvironment } from "./environment";

const environmentProps = { environment: "dev" as const, onEnvironmentChange: () => undefined };

describe("AppShell", () => {
  it("supports click and keyboard tab navigation with panel visibility", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: string[] = [];
    act(() => { root.render(<AppShell {...environmentProps} onTabChange={(tab) => changes.push(tab)} approvalPane={<p>A</p>} sessionsPane={<p>S</p>} providersPane={<p>P</p>} workersPane={<p>W</p>} />); });
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Cockpit sections"] [role=tab]')];
    act(() => { tabs[1].click(); });
    expect(changes).toEqual(["sessions"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[id$="-tab-panel-sessions"]')?.hasAttribute("hidden")).toBe(false);
    act(() => { tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(document.activeElement).toBe(tabs[2]);
    act(() => { tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    expect(document.activeElement).toBe(tabs[3]);
    act(() => { tabs[3].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
    expect(document.activeElement).toBe(tabs[0]);
    act(() => { root.unmount(); });
    host.remove();
  });

  it("has no automated axe accessibility violations", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<AppShell {...environmentProps} approvalPane={<p>Approval</p>} sessionsPane={<p>Sessions</p>} providersPane={<p>Providers</p>} workersPane={<p>Workers</p>} />); });
    const result = await axe.run(host, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
    act(() => { root.unmount(); });
    host.remove();
  });

  it("renders the three desktop regions and selected context", () => {
    const html = renderToStaticMarkup(
      <AppShell
        {...environmentProps}
        selectedProject={{ id: "p1", name: "Autopilot" }}
        selectedSession={{ id: "s1", name: "Manager", status: "running", agent: "claude_cli" }}
        projectsPane={<p>Projects</p>}
        approvalPane={<p>Approvals</p>}
        operationsPane={<p>Workers</p>}
      />,
    );
    expect(html).toContain('data-pane="projects"');
    expect(html).toContain('data-pane="approval"');
    expect(html).toContain('data-pane="operations"');
    expect(html).toContain("Autopilot");
    expect(html).toContain("Manager");
    expect(html).toContain("Running");
  });

  it("renders narrow navigation tabs in the documented accessible order", () => {
    const html = renderToStaticMarkup(<AppShell {...environmentProps} projectsPane={<p>A</p>} approvalPane={<p>B</p>} operationsPane={<p>C</p>} />);
    const sectionNav = html.match(/<nav class="cockpit-tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const tabs = [...sectionNav.matchAll(/role="tab"[^>]*>([^<]+)/g)].map((match) => match[1]);
    expect(tabs).toEqual(["Approval", "Sessions", "Providers", "Workers"]);
    expect(html).toMatch(/aria-controls="[^"]+-tab-panel-approval"/);
    expect(html).toContain('role="tabpanel"');
    expect(html).toMatch(/aria-labelledby="[^"]+-tab-approval"/);
    expect(html).toContain('hidden=""');
  });

  it("keeps distinct session, provider, and worker slots available", () => {
    const html = renderToStaticMarkup(<AppShell {...environmentProps} sessionsPane={<p>Sessions slot</p>} providersPane={<p>Providers slot</p>} workersPane={<p>Workers slot</p>} />);
    expect(html).toContain("Sessions slot");
    expect(html).toContain("Providers slot");
    expect(html).toContain("Workers slot");
  });

  it("renders the run workspace before its inspector and supports inspector keyboard tabs", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => { root.render(<AppShell {...environmentProps} runWorkspace={<p>Composer</p>} runInspector={<p>Evidence</p>} incidentPane={<p>autopilot_internal_error</p>} />); });
    const workspace = host.querySelector('[aria-label="Pracovní plocha běhu"]'); const inspector = host.querySelector('[aria-label="Inspektor běhu"]');
    expect(workspace).not.toBeNull(); expect(inspector).not.toBeNull(); expect(workspace?.compareDocumentPosition(inspector!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Inspektor běhu"] [role="tab"]')];
    const panel = inspector?.querySelector('[role="tabpanel"]'); expect(tabs.map((tab) => tab.textContent)).toEqual(["Běh", "Chyby"]); expect(tabs[0]?.getAttribute("aria-controls")).toBe(panel?.id); expect(panel?.getAttribute("aria-labelledby")).toBe(tabs[0]?.id); act(() => tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))); expect(document.activeElement).toBe(tabs[1]); expect(panel?.getAttribute("aria-labelledby")).toBe(tabs[1]?.id); expect(host.textContent).toContain("autopilot_internal_error");
    act(() => root.unmount()); host.remove();
  });

  it("scopes tab ids and keyboard focus to each shell instance", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); act(() => root.render(<><AppShell {...environmentProps} runWorkspace="A" runInspector="A" /><AppShell {...environmentProps} runWorkspace="B" runInspector="B" /></>));
    const shells = [...host.querySelectorAll<HTMLElement>(".cockpit-shell")]; const firstIds = new Set([...shells[0]!.querySelectorAll("[id]")].map((node) => node.id)); const secondIds = [...shells[1]!.querySelectorAll("[id]")].map((node) => node.id); expect(secondIds.some((id) => firstIds.has(id))).toBe(false);
    const secondTabs = [...shells[1]!.querySelectorAll<HTMLButtonElement>('.run-inspector-pane [role="tab"]')]; act(() => secondTabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))); expect(document.activeElement).toBe(secondTabs[1]);
    act(() => root.unmount()); host.remove();
  });

  it("shows separate DEV and PROD environments and scopes the active one", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    function EnvironmentRegion({ environment }: { readonly environment: CockpitEnvironment }) { return <section role="region" aria-label={environment === "dev" ? "Vývoj" : "Produkce"} />; }
    function Harness() { const [environment, setEnvironment] = React.useState<CockpitEnvironment>("dev"); return <AppShell environment={environment} onEnvironmentChange={setEnvironment} runWorkspace={<EnvironmentRegion environment={environment} />} />; }
    act(() => root.render(<Harness />));
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Prostředí Cockpitu"] [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["DEV", "PROD"]);
    act(() => tabs[1]!.click());
    expect(host.querySelector('[role="region"][aria-label="Produkce"]')).not.toBeNull();
    act(() => root.unmount()); host.remove();
  });

  it("moves between environment tabs with arrow keys", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    function Harness() { const [environment, setEnvironment] = React.useState<CockpitEnvironment>("dev"); return <AppShell environment={environment} onEnvironmentChange={setEnvironment} />; }
    act(() => root.render(<Harness />));
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Prostředí Cockpitu"] [role="tab"]')];
    act(() => tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true"); expect(document.activeElement).toBe(tabs[1]);
    act(() => tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true"); expect(document.activeElement).toBe(tabs[0]);
    act(() => root.unmount()); host.remove();
  });
});
