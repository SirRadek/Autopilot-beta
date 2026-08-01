import React, { useId } from "react";
import type { RunRecord, RunStatus } from "../../types/controlPlane";
import { StatusBadge, type StatusBadgeStatus } from "../../components/StatusBadge";

const MAX_TITLE_CHARS = 80;
const badgeByRunStatus: Record<RunStatus, StatusBadgeStatus> = { draft: "waiting", approved: "waiting", queued: "waiting", running: "running", completed: "completed", failed: "error", cancelled: "blocked" };

export type RunDetailViewProps = {
  readonly run?: RunRecord;
  readonly runInspector: React.ReactNode;
  readonly promotionPane: React.ReactNode;
};

function runTitle(run: RunRecord): string {
  const firstLine = run.current.prompt.trim().split("\n", 1)[0] ?? "";
  if (firstLine === "") return run.current.run_id;
  return firstLine.length > MAX_TITLE_CHARS ? `${firstLine.slice(0, MAX_TITLE_CHARS)}…` : firstLine;
}

export function RunDetailView({ run, runInspector, promotionPane }: RunDetailViewProps) {
  const idPrefix = useId(); const id = (suffix: string) => `${idPrefix}-${suffix}`;
  return <div className="run-detail">
    {run ? <>
      <header className="cockpit-card run-status-header" aria-label="Stav běhu">
        <div className="run-status-heading">
          <div className="run-status-title">
            <p className="run-status-id">{run.current.run_id} · revize {run.current.revision} (immutable)</p>
            <h2>{runTitle(run)}</h2>
          </div>
          <StatusBadge status={badgeByRunStatus[run.status]} />
          <div className="run-status-actions">
            <span className="planned-badge">Planned</span>
            <button type="button" disabled title="Planned">Pauza</button>
            <button type="button" disabled title="Planned">Zastavit</button>
          </div>
        </div>
        <ul className="run-status-facts" aria-label="Fakta běhu">
          <li className="run-fact">stav {run.status}</li>
          <li className="run-fact">{run.current.provider} · {run.current.model ?? "auto"}</li>
          <li className="run-fact">odhad {run.current.estimated_tokens.toLocaleString()} tokenů</li>
          <li className="run-fact">profil {run.current.profile}</li>
        </ul>
      </header>
      <section className="cockpit-card run-detail-section" aria-labelledby={id("progress-heading")}>
        <h3 id={id("progress-heading")}>Průběh &amp; důkazy</h3>
        {runInspector}
      </section>
    </> : <section className="cockpit-card" aria-label="Detail běhu"><p className="run-detail-empty">Vyber běh v Command Center.</p></section>}
    <section className="cockpit-card run-detail-section" aria-labelledby={id("promotion-heading")}>
      <h3 id={id("promotion-heading")}>Propagace</h3>
      {promotionPane}
    </section>
  </div>;
}
