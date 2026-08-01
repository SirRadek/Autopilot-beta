import React, { useId, useState } from "react";

export type AutonomyPreset = "propose" | "safe_steps" | "full";

type AutonomyPermission = { readonly label: string; readonly allowed: boolean };
type AutonomyOption = { readonly id: AutonomyPreset; readonly label: string; readonly sandbox: string; readonly permissions: readonly AutonomyPermission[] };

const autonomyById: Record<AutonomyPreset, AutonomyOption> = {
  propose: { id: "propose", label: "Navrhovat", sandbox: "read-only", permissions: [{ label: "Editovat", allowed: false }, { label: "Spouštět", allowed: false }, { label: "Utrácet", allowed: false }, { label: "Publikovat", allowed: false }] },
  safe_steps: { id: "safe_steps", label: "Bezpečné kroky", sandbox: "workspace-write", permissions: [{ label: "Editovat", allowed: true }, { label: "Spouštět", allowed: true }, { label: "Utrácet", allowed: false }, { label: "Publikovat", allowed: false }] },
  full: { id: "full", label: "Plný autopilot", sandbox: "workspace-write", permissions: [{ label: "Editovat", allowed: true }, { label: "Spouštět", allowed: true }, { label: "Utrácet", allowed: true }, { label: "Publikovat", allowed: false }] },
};
const autonomyOptions: readonly AutonomyOption[] = [autonomyById.propose, autonomyById.safe_steps, autonomyById.full];

export type NewRunViewProps = {
  readonly composer: React.ReactNode;
  readonly environment: "dev" | "prod";
};

export function NewRunView({ composer, environment }: NewRunViewProps) {
  const idPrefix = useId(); const id = (suffix: string) => `${idPrefix}-${suffix}`;
  const [autonomy, setAutonomy] = useState<AutonomyPreset>("propose");
  const selectedAutonomy = autonomyById[autonomy];
  const composerAvailable = environment === "dev" && composer !== null && composer !== undefined && composer !== false;
  return <div className="new-run">
    <header className="new-run-header">
      <span className="eyebrow">Řízení běhu</span>
      <h2>Nový běh</h2>
      <p className="new-run-subtitle">Zadej co udělat; orchestrátor rozplánuje a rozdělí. Držíš mantinely.</p>
    </header>
    <div className="new-run-grid">
      <div className="new-run-column">
        <section className="cockpit-card new-run-section" aria-labelledby={id("brief-heading")}>
          <h3 id={id("brief-heading")}>Zadání &amp; orchestrace</h3>
          {composerAvailable ? composer : <p className="run-detail-empty">Nové běhy jen v DEV.</p>}
        </section>
        <section className="cockpit-card new-run-section" aria-labelledby={id("autonomy-heading")}>
          <h3 id={id("autonomy-heading")}>Autonomie</h3>
          <div className="autonomy-cards">
            {autonomyOptions.map((option) => <label key={option.id} className={option.id === autonomy ? "autonomy-card selected" : "autonomy-card"}>
              <span className="autonomy-card-head">
                <input type="radio" name="autonomy" value={option.id} checked={option.id === autonomy} onChange={() => setAutonomy(option.id)} />
                {option.label}
              </span>
              <span className="autonomy-permissions">
                {option.permissions.map((permission) => <span key={permission.label} className="autonomy-permission">
                  {permission.label} <b className={permission.allowed ? "autonomy-yes" : "autonomy-no"} role="img" aria-label={permission.allowed ? "povoleno" : "zakázáno"}>{permission.allowed ? "✓" : "✗"}</b>
                </span>)}
              </span>
            </label>)}
          </div>
          <p className="autonomy-note">Vynucení autonomie na straně serveru: Planned. Výběr je zatím jen UI preset a neodesílá se do Control Plane.</p>
        </section>
      </div>
      <aside className="cockpit-card run-envelope" aria-label="Obálka běhu">
        <span className="eyebrow">Souhrn &amp; odhady</span>
        <h3>Obálka běhu</h3>
        <dl className="run-envelope-list">
          <div><dt>Projekt</dt><dd>podle výběru v zadání</dd></div>
          <div><dt>Režim</dt><dd>Běh · prepare → review → approve</dd></div>
          <div><dt>Orchestrátor</dt><dd>poskytovatel · model · reasoning ze zadání</dd></div>
          <div><dt>Autonomie</dt><dd>{selectedAutonomy.label}</dd></div>
          <div><dt>Sandbox</dt><dd>{selectedAutonomy.sandbox}</dd></div>
          <div><dt>Odhad</dt><dd>prompt + 8 192 tokenů rezervace</dd></div>
        </dl>
        <p className="run-envelope-note">Reálné odhady, kvóty a immutable revizi ukáže composer po „Připravit běh“.</p>
      </aside>
    </div>
  </div>;
}
