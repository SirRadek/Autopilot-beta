import React, { useId } from "react";

export type RulesViewProps = {
  readonly brainstormPane: React.ReactNode;
};

const MESH_RULE_CATEGORIES = ["Hranice běhu", "Routing & náklady", "Kvalita & dohled", "Obsah & design"] as const;

export function RulesView({ brainstormPane }: RulesViewProps) {
  const idPrefix = useId(); const id = (suffix: string) => `${idPrefix}-${suffix}`;
  return <div className="rules-view">
    <header className="rules-header">
      <span className="eyebrow">Governance</span>
      <h2>Pravidla &amp; Skills</h2>
    </header>
    <div className="rules-grid">
      <section className="cockpit-card rules-section rules-section-brainstorm" aria-labelledby={id("brainstorm")}>
        <h3 id={id("brainstorm")}>Brainstorm &amp; fan-out</h3>
        {brainstormPane}
      </section>
      <section className="cockpit-card rules-section planned" aria-labelledby={id("mesh")}>
        <h3 id={id("mesh")}>Pravidla (Decision Mesh) <span className="planned-badge">Planned</span></h3>
        <p className="planned-note">Živý stav pravidel z mesh: Planned (bez endpointu).</p>
        <ul className="rules-mesh-categories" aria-label="Kategorie pravidel (statická reference)">
          {MESH_RULE_CATEGORIES.map((category) => <li key={category}>{category}</li>)}
        </ul>
      </section>
      <section className="cockpit-card rules-section planned" aria-labelledby={id("skills")}>
        <h3 id={id("skills")}>Skills (prompt-library) <span className="planned-badge">Planned</span></h3>
        <p className="planned-note">Katalog skills a per-run výběr: Planned. Skills se dnes vážou k běhům přes approval evidence.</p>
      </section>
    </div>
  </div>;
}
