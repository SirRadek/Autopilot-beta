import React, { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { StatusBadge, type StatusBadgeStatus } from "../components/StatusBadge";
import type { CockpitEnvironment } from "./environment";
import "./tokens.css";
import "./app.css";

export type CockpitSession = { id: string; name: string; status: StatusBadgeStatus; agent?: string };
export type CockpitProject = { id: string; name: string };
export type CockpitView = "command" | "run" | "resources" | "new-run" | "rules";

export type AppShellProps = {
  environment: CockpitEnvironment;
  onEnvironmentChange: (environment: CockpitEnvironment) => void;
  onLogout?: () => Promise<void>;
  selectedProject?: CockpitProject;
  selectedSession?: CockpitSession;
  activeView?: CockpitView;
  onViewChange?: (view: CockpitView) => void;
  commandView?: ReactNode;
  runView?: ReactNode;
  resourcesView?: ReactNode;
  newRunView?: ReactNode;
  rulesView?: ReactNode;
};

const views: Array<{ id: CockpitView; label: string }> = [
  { id: "command", label: "Command Center" },
  { id: "run", label: "Detail běhu" },
  { id: "resources", label: "Zdroje & zdraví" },
  { id: "new-run", label: "Nový běh" },
  { id: "rules", label: "Pravidla & Skills" },
];

export function AppShell({ environment, onEnvironmentChange, onLogout, selectedProject, selectedSession, activeView, onViewChange, commandView, runView, resourcesView, newRunView, rulesView }: AppShellProps) {
  const [internalView, setInternalView] = useState<CockpitView>(activeView ?? "command");
  const currentView = activeView ?? internalView;
  const idPrefix = useId();
  const viewTabRefs = useRef<Partial<Record<CockpitView, HTMLButtonElement>>>({});
  const environmentTabRefs = useRef<Partial<Record<CockpitEnvironment, HTMLButtonElement>>>({});
  const id = (suffix: string) => `${idPrefix}-${suffix}`;
  const slots: Record<CockpitView, ReactNode> = { command: commandView, run: runView, resources: resourcesView, "new-run": newRunView, rules: rulesView };
  const selectView = (view: CockpitView) => { setInternalView(view); onViewChange?.(view); };
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
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (index + direction + views.length) % views.length;
    const next = views[nextIndex];
    selectView(next.id);
    viewTabRefs.current[next.id]?.focus();
  };
  return (
    <div className="cockpit-shell">
      <header className="cockpit-sidebar">
        <div className="cockpit-brand">
          <span className="cockpit-brand-mark" aria-hidden="true">A</span>
          <h1>Autopilot</h1>
        </div>
        <nav className="cockpit-nav" aria-label="Cockpit sections" role="tablist">
          {views.map((view, index) => <button ref={(node) => { if (node) viewTabRefs.current[view.id] = node; }} key={view.id} id={id(`tab-${view.id}`)} data-cockpit-view={view.id} type="button" role="tab" aria-controls={id(`view-panel-${view.id}`)} aria-selected={currentView === view.id} tabIndex={currentView === view.id ? 0 : -1} onClick={() => selectView(view.id)} onKeyDown={(event) => handleTabKeyDown(event, index)}>{view.label}</button>)}
        </nav>
      </header>
      <main className="cockpit-main">
        <div className="cockpit-topbar">
          <div className="selection-context" aria-label="Selected context">
            <span>{selectedProject?.name ?? "No project selected"}</span>
            {selectedSession ? <><span aria-hidden="true">/</span><span>{selectedSession.name}</span><StatusBadge status={selectedSession.status} /></> : null}
          </div>
          <nav className="cockpit-environments" aria-label="Prostředí Cockpitu" role="tablist">
            {(["dev", "prod"] as const).map((candidate) => <button ref={(node) => { if (node) environmentTabRefs.current[candidate] = node; }} key={candidate} type="button" role="tab" aria-selected={environment === candidate} tabIndex={environment === candidate ? 0 : -1} onClick={() => onEnvironmentChange(candidate)} onKeyDown={(event) => handleEnvironmentKeyDown(event, candidate)}>{candidate.toUpperCase()}</button>)}
          </nav>
          {onLogout ? <button className="cockpit-logout" type="button" onClick={onLogout}>Odhlásit</button> : null}
        </div>
        <div className="cockpit-views">
          {views.map((view) => <section key={view.id} className="cockpit-view" id={id(`view-panel-${view.id}`)} role="tabpanel" aria-labelledby={id(`tab-${view.id}`)} hidden={currentView !== view.id}>{slots[view.id]}</section>)}
        </div>
      </main>
    </div>
  );
}
