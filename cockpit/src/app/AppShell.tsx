import React, { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { StatusBadge, type StatusBadgeStatus } from "../components/StatusBadge";
import type { CockpitEnvironment } from "./environment";
import "./app.css";

export type CockpitSession = { id: string; name: string; status: StatusBadgeStatus; agent?: string };
export type CockpitProject = { id: string; name: string };
export type CockpitTab = "approval" | "sessions" | "providers" | "workers" | "brainstorm";

export type AppShellProps = {
  environment: CockpitEnvironment;
  onEnvironmentChange: (environment: CockpitEnvironment) => void;
  selectedProject?: CockpitProject;
  selectedSession?: CockpitSession;
  projectsPane?: ReactNode;
  sessionsPane?: ReactNode;
  approvalPane?: ReactNode;
  operationsPane?: ReactNode;
  providersPane?: ReactNode;
  workersPane?: ReactNode;
  runWorkspace?: ReactNode;
  runInspector?: ReactNode;
  incidentPane?: ReactNode;
  brainstormPane?: ReactNode;
  onTabChange?: (tab: CockpitTab) => void;
};

const tabs: Array<{ id: CockpitTab; label: string }> = [
  { id: "approval", label: "Approval" },
  { id: "sessions", label: "Sessions" },
  { id: "providers", label: "Providers" },
  { id: "workers", label: "Workers" },
  { id: "brainstorm", label: "Brainstorm" },
];

export function AppShell({ environment, onEnvironmentChange, selectedProject, selectedSession, projectsPane, sessionsPane, approvalPane, operationsPane, providersPane, workersPane, runWorkspace, runInspector, incidentPane, brainstormPane, onTabChange }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<CockpitTab>("approval");
  const [inspectorTab, setInspectorTab] = useState<"run" | "errors">("run");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const idPrefix = useId();
  const tabRefs = useRef<Partial<Record<CockpitTab, HTMLButtonElement>>>({});
  const environmentTabRefs = useRef<Partial<Record<CockpitEnvironment, HTMLButtonElement>>>({});
  const inspectorTabRefs = useRef<Partial<Record<"run" | "errors", HTMLButtonElement>>>({});
  const id = (suffix: string) => `${idPrefix}-${suffix}`;
  const selectTab = (tab: CockpitTab) => { setActiveTab(tab); onTabChange?.(tab); };
  const handleEnvironmentKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: CockpitEnvironment) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: CockpitEnvironment = event.key === "Home" ? "dev" : event.key === "End" ? "prod" : current === "dev" ? "prod" : "dev";
    onEnvironmentChange(next);
    environmentTabRefs.current[next]?.focus();
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    selectTab(next.id);
    tabRefs.current[next.id]?.focus();
  };
  const handleInspectorKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return; event.preventDefault(); const next = event.key === "Home" ? "run" : event.key === "End" ? "errors" : inspectorTab === "run" ? "errors" : "run"; setInspectorTab(next); inspectorTabRefs.current[next]?.focus(); };
  return (
    <div className="cockpit-shell">
      <header className="cockpit-header">
        <div>
          <p className="eyebrow">Autopilot Control Plane</p>
          <h1>Hybrid Cockpit</h1>
        </div>
        <div className="selection-context" aria-label="Selected context">
          <span>{selectedProject?.name ?? "No project selected"}</span>
          {selectedSession ? <><span aria-hidden="true">/</span><span>{selectedSession.name}</span><StatusBadge status={selectedSession.status} /></> : null}
        </div>
      </header>
      <nav className="cockpit-environments" aria-label="Prostředí Cockpitu" role="tablist">
        {(["dev", "prod"] as const).map((candidate) => <button ref={(node) => { if (node) environmentTabRefs.current[candidate] = node; }} key={candidate} type="button" role="tab" aria-selected={environment === candidate} tabIndex={environment === candidate ? 0 : -1} onClick={() => onEnvironmentChange(candidate)} onKeyDown={(event) => handleEnvironmentKeyDown(event, candidate)}>{candidate.toUpperCase()}</button>)}
      </nav>
      {runWorkspace !== undefined || runInspector !== undefined || incidentPane !== undefined ? <div className={`run-control-room${inspectorOpen ? "" : " inspector-collapsed"}`}>
        <section className="run-workspace" role="region" aria-label="Pracovní plocha běhu">{runWorkspace}</section>
        <aside className="run-inspector-pane" aria-label="Inspektor běhu"><button className="inspector-toggle" type="button" aria-expanded={inspectorOpen} aria-controls={id("inspector-content")} onClick={() => setInspectorOpen((open) => !open)}>{inspectorOpen ? "Skrýt inspektor" : "Zobrazit inspektor"}</button>{inspectorOpen ? <div id={id("inspector-content")}><div className="inspector-tabs" role="tablist" aria-label="Části inspektoru"><button ref={(node) => { if (node) inspectorTabRefs.current.run = node; }} id={id("inspector-tab-run")} data-inspector-tab="run" type="button" role="tab" aria-controls={id("inspector-panel")} aria-selected={inspectorTab === "run"} tabIndex={inspectorTab === "run" ? 0 : -1} onClick={() => setInspectorTab("run")} onKeyDown={handleInspectorKeyDown}>Běh</button><button ref={(node) => { if (node) inspectorTabRefs.current.errors = node; }} id={id("inspector-tab-errors")} data-inspector-tab="errors" type="button" role="tab" aria-controls={id("inspector-panel")} aria-selected={inspectorTab === "errors"} tabIndex={inspectorTab === "errors" ? 0 : -1} onClick={() => setInspectorTab("errors")} onKeyDown={handleInspectorKeyDown}>Chyby</button></div><div id={id("inspector-panel")} role="tabpanel" aria-labelledby={id(`inspector-tab-${inspectorTab}`)}>{inspectorTab === "run" ? runInspector : incidentPane}</div></div> : null}</aside>
      </div> : null}
      <nav className="cockpit-tabs" aria-label="Cockpit sections" role="tablist">
        {tabs.map((tab, index) => <button ref={(node) => { if (node) tabRefs.current[tab.id] = node; }} key={tab.id} id={id(`tab-${tab.id}`)} data-cockpit-tab={tab.id} type="button" role="tab" aria-controls={id(`tab-panel-${tab.id}`)} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => selectTab(tab.id)} onKeyDown={(event) => handleTabKeyDown(event, index)}>{tab.label}</button>)}
      </nav>
      <div className="cockpit-grid">
        <aside className="cockpit-pane desktop-pane pane-projects" data-pane="projects" aria-label="Projects and Sessions"><h2>Projects &amp; Sessions</h2>{projectsPane}{sessionsPane}</aside>
        <main className="cockpit-pane desktop-pane pane-approval" data-pane="approval" aria-label="Approval and Workflow"><h2>Approval &amp; Workflow</h2>{approvalPane}</main>
        <aside className="cockpit-pane desktop-pane pane-operations" data-pane="operations" aria-label="Live Operations and Provider Budget"><h2>Live Operations &amp; Provider Budget</h2>{operationsPane}{workersPane ? <section aria-label="Workers">{workersPane}</section> : null}{providersPane ? <section className="provider-slot" aria-label="Provider Budget">{providersPane}</section> : null}</aside>
      </div>
      {brainstormPane !== undefined ? <div className="cockpit-pane desktop-pane pane-brainstorm" data-pane="brainstorm">{brainstormPane}</div> : null}
      <div className="mobile-panels">
        <section id={id("tab-panel-approval")} className="cockpit-pane tab-panel" role="tabpanel" aria-labelledby={id("tab-approval")} hidden={activeTab !== "approval"}>{approvalPane}</section>
        <section id={id("tab-panel-sessions")} className="cockpit-pane tab-panel" role="tabpanel" aria-labelledby={id("tab-sessions")} hidden={activeTab !== "sessions"}>{sessionsPane ?? projectsPane}</section>
        <section id={id("tab-panel-providers")} className="cockpit-pane tab-panel" role="tabpanel" aria-labelledby={id("tab-providers")} hidden={activeTab !== "providers"}>{providersPane}</section>
        <section id={id("tab-panel-workers")} className="cockpit-pane tab-panel" role="tabpanel" aria-labelledby={id("tab-workers")} hidden={activeTab !== "workers"}>{workersPane ?? operationsPane}</section>
        <section id={id("tab-panel-brainstorm")} className="cockpit-pane tab-panel" role="tabpanel" aria-labelledby={id("tab-brainstorm")} hidden={activeTab !== "brainstorm"}>{brainstormPane}</section>
      </div>
    </div>
  );
}
