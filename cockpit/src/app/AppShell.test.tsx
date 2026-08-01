import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axe from "axe-core";
import { renderToStaticMarkup } from "react-dom/server";

import { AppShell, type CockpitView } from "./AppShell";
import type { CockpitEnvironment } from "./environment";

const environmentProps = { environment: "dev" as const, onEnvironmentChange: () => undefined };
const viewLabels = ["Command Center", "Detail běhu", "Zdroje & zdraví", "Nový běh", "Pravidla & Skills"];

function navTabs(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Cockpit sections"] [role=tab]')];
}

describe("AppShell", () => {
  it("renders the five cockpit views in the documented accessible order", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => { root.render(<AppShell {...environmentProps} commandView={<p>Command</p>} />); });
    expect(navTabs(host).map((tab) => tab.textContent)).toEqual(viewLabels);
    expect(navTabs(host).map((tab) => tab.dataset.cockpitView)).toEqual(["command", "run", "resources", "new-run", "rules"]);
    act(() => { root.unmount(); });
    host.remove();

    const html = renderToStaticMarkup(<AppShell {...environmentProps} commandView={<p>Command</p>} />);
    expect(html).toMatch(/aria-controls="[^"]+-view-panel-command"/);
    expect(html).toContain('role="tabpanel"');
    expect(html).toMatch(/aria-labelledby="[^"]+-tab-command"/);
    expect(html).toContain('hidden=""');
  });

  it("wires every tab to its own panel and hides the inactive ones", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => { root.render(<AppShell {...environmentProps} commandView={<p>Command</p>} />); });
    const tabs = navTabs(host);
    const panels = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(panels).toHaveLength(5);
    for (const [index, tab] of tabs.entries()) {
      expect(tab.getAttribute("aria-controls")).toBe(panels[index]!.id);
      expect(panels[index]!.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(panels[index]!.hasAttribute("hidden")).toBe(index !== 0);
    }
    act(() => { root.unmount(); });
    host.remove();
  });

  it("renders each view slot inside its own panel", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => { root.render(<AppShell {...environmentProps} commandView={<p>Command slot</p>} runView={<p>Run slot</p>} resourcesView={<p>Resources slot</p>} newRunView={<p>New run slot</p>} rulesView={<p>Rules slot</p>} />); });
    const panel = (view: CockpitView) => host.querySelector<HTMLElement>(`[id$="-view-panel-${view}"]`);
    expect(panel("command")?.textContent).toBe("Command slot");
    expect(panel("run")?.textContent).toBe("Run slot");
    expect(panel("resources")?.textContent).toBe("Resources slot");
    expect(panel("new-run")?.textContent).toBe("New run slot");
    expect(panel("rules")?.textContent).toBe("Rules slot");
    act(() => { root.unmount(); });
    host.remove();
  });

  it("supports click and keyboard view navigation with panel visibility", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: CockpitView[] = [];
    act(() => { root.render(<AppShell {...environmentProps} onViewChange={(view) => changes.push(view)} commandView={<p>C</p>} runView={<p>R</p>} resourcesView={<p>Z</p>} newRunView={<p>N</p>} rulesView={<p>P</p>} />); });
    const tabs = navTabs(host);
    act(() => { tabs[1].click(); });
    expect(changes).toEqual(["run"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);
    expect(host.querySelector('[id$="-view-panel-run"]')?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector('[id$="-view-panel-command"]')?.hasAttribute("hidden")).toBe(true);
    act(() => { tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    act(() => { tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    expect(document.activeElement).toBe(tabs[4]);
    act(() => { tabs[4].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
    expect(document.activeElement).toBe(tabs[0]);
    expect(changes).toEqual(["run", "resources", "rules", "command"]);
    act(() => { root.unmount(); });
    host.remove();
  });

  it("follows a controlled active view", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      const [view, setView] = React.useState<CockpitView>("resources");
      return <AppShell {...environmentProps} activeView={view} onViewChange={setView} resourcesView={<p>Resources</p>} rulesView={<p>Rules</p>} />;
    }
    act(() => { root.render(<Harness />); });
    expect(navTabs(host)[2]!.getAttribute("aria-selected")).toBe("true");
    act(() => { navTabs(host)[4]!.click(); });
    expect(navTabs(host)[4]!.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[id$="-view-panel-rules"]')?.hasAttribute("hidden")).toBe(false);
    act(() => { root.unmount(); });
    host.remove();
  });

  it("renders the selected project and session context", () => {
    const html = renderToStaticMarkup(
      <AppShell
        {...environmentProps}
        selectedProject={{ id: "p1", name: "Autopilot Beta" }}
        selectedSession={{ id: "s1", name: "Manager", status: "running", agent: "claude_cli" }}
        commandView={<p>Approvals</p>}
      />,
    );
    expect(html).toContain("Autopilot Beta");
    expect(html).toContain("Manager");
    expect(html).toContain("Running");
  });

  it("has no automated axe accessibility violations", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<AppShell {...environmentProps} commandView={<p>Command</p>} runView={<p>Run</p>} resourcesView={<p>Resources</p>} newRunView={<p>New run</p>} rulesView={<p>Rules</p>} />); });
    const result = await axe.run(host, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
    act(() => { root.unmount(); });
    host.remove();
  });

  it("scopes view ids and keyboard focus to each shell instance", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    act(() => root.render(<><AppShell {...environmentProps} commandView="A" /><AppShell {...environmentProps} commandView="B" /></>));
    const shells = [...host.querySelectorAll<HTMLElement>(".cockpit-shell")];
    const firstIds = new Set([...shells[0]!.querySelectorAll("[id]")].map((node) => node.id));
    const secondIds = [...shells[1]!.querySelectorAll("[id]")].map((node) => node.id);
    expect(secondIds.some((id) => firstIds.has(id))).toBe(false);
    const secondTabs = navTabs(shells[1]!);
    act(() => secondTabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(secondTabs[1]);
    act(() => root.unmount()); host.remove();
  });

  it("shows separate DEV and PROD environments and scopes the active one", () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    function EnvironmentRegion({ environment }: { readonly environment: CockpitEnvironment }) { return <section role="region" aria-label={environment === "dev" ? "Vývoj" : "Produkce"} />; }
    function Harness() { const [environment, setEnvironment] = React.useState<CockpitEnvironment>("dev"); return <AppShell environment={environment} onEnvironmentChange={setEnvironment} commandView={<EnvironmentRegion environment={environment} />} />; }
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
