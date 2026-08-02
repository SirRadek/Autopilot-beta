import React, { useId } from "react";

export type ResourcesViewProps = {
  readonly providersPane: React.ReactNode;
  readonly workersPane: React.ReactNode;
  readonly sessionsPane: React.ReactNode;
  readonly projectsPane: React.ReactNode;
};

export function ResourcesView({ providersPane, workersPane, sessionsPane, projectsPane }: ResourcesViewProps) {
  const idPrefix = useId(); const id = (suffix: string) => `${idPrefix}-${suffix}`;
  return <div className="resources-view">
    <header className="resources-header">
      <span className="eyebrow">Kapacita</span>
      <h2>Zdroje &amp; zdraví</h2>
    </header>
    <div className="resources-grid">
      <section className="cockpit-card resources-section" aria-labelledby={id("providers")}>
        <h3 id={id("providers")}>Provideři &amp; limity</h3>
        {providersPane}
      </section>
      <section className="cockpit-card resources-section" aria-labelledby={id("workers")}>
        <h3 id={id("workers")}>Workeři</h3>
        {workersPane}
      </section>
      <section className="cockpit-card resources-section" aria-labelledby={id("sessions")}>
        <h3 id={id("sessions")}>Sessions</h3>
        {sessionsPane}
      </section>
      <section className="cockpit-card resources-section" aria-labelledby={id("projects")}>
        <h3 id={id("projects")}>Projekty</h3>
        {projectsPane}
      </section>
      <section className="cockpit-card resources-section planned" aria-labelledby={id("routing")}>
        <h3 id={id("routing")}>Rozdělení práce <span className="planned-badge">Planned</span></h3>
        <p className="planned-note">Vyžaduje kapacitní routing na straně serveru.</p>
      </section>
      <section className="cockpit-card resources-section planned" aria-labelledby={id("mcp")}>
        <h3 id={id("mcp")}>MCP servery (cross) <span className="planned-badge">Planned</span></h3>
        <p className="planned-note">Kanonická MCP konfigurace syncovaná do CLI — připravováno.</p>
      </section>
    </div>
  </div>;
}
