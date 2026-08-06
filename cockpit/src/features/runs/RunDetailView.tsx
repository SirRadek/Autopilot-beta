import React, { useId, useState } from "react";
import type { RunRecord, RunStatus } from "../../types/controlPlane";
import { StatusBadge, type StatusBadgeStatus } from "../../components/StatusBadge";
import { CANCELLABLE_STATUSES, RUN_STATUS_LABELS } from "../command/CommandCenter";
import { DesignPane, extractFigmaUrl } from "./DesignPane";

const MAX_TITLE_CHARS = 80;
const badgeByRunStatus: Record<RunStatus, StatusBadgeStatus> = { draft: "waiting", approved: "waiting", queued: "waiting", running: "running", completed: "completed", failed: "error", cancelled: "blocked" };

export type RunDetailViewProps = {
  readonly run?: RunRecord;
  readonly runInspector: React.ReactNode;
  readonly promotionPane: React.ReactNode;
  readonly onCancelRun?: (run: RunRecord) => Promise<void>;
};

function runTitle(run: RunRecord): string {
  const firstLine = run.current.prompt.trim().split("\n", 1)[0] ?? "";
  if (firstLine === "") return run.current.run_id;
  return firstLine.length > MAX_TITLE_CHARS ? `${firstLine.slice(0, MAX_TITLE_CHARS)}…` : firstLine;
}

export function RunDetailView({ run, runInspector, promotionPane, onCancelRun }: RunDetailViewProps) {
  const idPrefix = useId(); const id = (suffix: string) => `${idPrefix}-${suffix}`;
  const [confirmCancelId, setConfirmCancelId] = useState<string | undefined>();
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<{ readonly runId: string; readonly message: string } | undefined>();
  const cancelRun = async (selectedRun: RunRecord) => {
    if (onCancelRun === undefined || !CANCELLABLE_STATUSES.includes(selectedRun.status)) return;
    setCancelBusy(true);
    setCancelError(undefined);
    try {
      await onCancelRun(selectedRun);
      setConfirmCancelId(undefined);
    } catch (caught) {
      setCancelError({ runId: selectedRun.current.run_id, message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setCancelBusy(false);
    }
  };
  return <div className="run-detail">
    {run ? <>
      <header className="cockpit-card run-status-header" aria-label="Stav běhu">
        <div className="run-status-heading">
          <div className="run-status-title">
            <p className="run-status-id">{run.current.run_id} · revize {run.current.revision} (neměnná)</p>
            <h2>{runTitle(run)}</h2>
          </div>
          <StatusBadge status={badgeByRunStatus[run.status]} />
          <div className="run-status-actions">
            <button type="button" disabled title="Plánováno">Pauza <span className="planned-badge">Plánováno</span></button>
            {onCancelRun !== undefined && CANCELLABLE_STATUSES.includes(run.status) && confirmCancelId === run.current.run_id ? <div role="group" aria-label="Potvrzení zastavení běhu">
              <span>Opravdu zastavit tento běh?</span>
              <button type="button" disabled={cancelBusy} onClick={() => void cancelRun(run)}>Potvrdit zastavení</button>
              <button type="button" disabled={cancelBusy} onClick={() => setConfirmCancelId(undefined)}>Ponechat</button>
            </div> : <button
              type="button"
              disabled={onCancelRun === undefined || !CANCELLABLE_STATUSES.includes(run.status)}
              onClick={() => { setCancelError(undefined); setConfirmCancelId(run.current.run_id); }}
            >Zastavit</button>}
          </div>
        </div>
        {cancelError?.runId === run.current.run_id ? <p role="alert">Zastavení selhalo: {cancelError.message}</p> : null}
        <ul className="run-status-facts" aria-label="Fakta běhu">
          <li className="run-fact">stav {RUN_STATUS_LABELS[run.status]}</li>
          <li className="run-fact">{run.current.provider} · {run.current.model ?? "auto"}</li>
          <li className="run-fact">odhad {run.current.estimated_tokens.toLocaleString()} tokenů</li>
          <li className="run-fact">profil {run.current.profile}</li>
        </ul>
      </header>
      <section className="cockpit-card run-detail-section" aria-labelledby={id("design-heading")}>
        <h3 id={id("design-heading")}>Návrh</h3>
        <DesignPane figmaUrl={extractFigmaUrl(run.current.prompt)} />
      </section>
      <section className="cockpit-card run-detail-section" aria-labelledby={id("progress-heading")}>
        <h3 id={id("progress-heading")}>Průběh &amp; důkazy</h3>
        {runInspector}
      </section>
    </> : <section className="cockpit-card" aria-label="Detail běhu"><p className="run-detail-empty">Vyber běh v řídicím centru.</p></section>}
    <section className="cockpit-card run-detail-section" aria-labelledby={id("promotion-heading")}>
      <h3 id={id("promotion-heading")}>Propagace</h3>
      {promotionPane}
    </section>
  </div>;
}
