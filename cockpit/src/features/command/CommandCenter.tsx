import React, { useRef, useState } from "react";
import type { ControlPlaneStatus, RunRecord, RunStatus } from "../../types/controlPlane";

export type CommandCenterProps = {
  readonly runs: readonly RunRecord[];
  readonly selectedRunId?: string;
  readonly onSelectRun: (runId: string) => void;
  readonly loading?: boolean;
  readonly refreshing?: boolean;
  readonly statusError?: string;
  readonly approvalPane: React.ReactNode;
  readonly status?: ControlPlaneStatus;
  readonly refreshedAt?: string;
  readonly now?: Date;
  readonly onApproveRun?: (run: RunRecord) => Promise<void>;
  readonly onCancelRun?: (run: RunRecord) => Promise<void>;
  readonly figmaPane?: React.ReactNode;
  readonly incidentAlert?: React.ReactNode;
};

export const WAITING_STATUSES: readonly RunStatus[] = ["draft", "approved", "queued"];
export const MAX_RUNS = 50;
export const STALE_RUN_MS = 15 * 60_000;
export const CANCELLABLE_STATUSES: readonly RunStatus[] = ["draft", "approved", "queued", "running"];

const MAX_PENDING_RUNS = 10;

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  draft: "Koncept",
  approved: "Schváleno",
  queued: "Ve frontě",
  running: "Běží",
  completed: "Dokončeno",
  failed: "Selhalo",
  cancelled: "Zrušeno",
};

type RunAction = "approve" | "cancel";

type RunActionState = {
  readonly busyRunId?: string;
  readonly actionError?: string;
  readonly confirmation?: {
    readonly action: RunAction;
    readonly runId: string;
  };
};

function runPriority(status: RunStatus): number {
  if (status === "running") return 0;
  if (WAITING_STATUSES.includes(status)) return 1;
  return 2;
}

function runDotClass(status: RunStatus): string {
  if (status === "running") return "cc-run-dot cc-run-dot-running";
  if (WAITING_STATUSES.includes(status)) return "cc-run-dot cc-run-dot-waiting";
  if (status === "failed") return "cc-run-dot cc-run-dot-failed";
  return "cc-run-dot cc-run-dot-idle";
}

function actionErrorMessage(caught: unknown): string {
  return (caught instanceof Error ? caught.message : String(caught)).slice(0, 300);
}

function staleRunAge(updatedAt: string, nowMs: number): string {
  const wholeMinutes = Math.max(0, Math.floor((nowMs - Date.parse(updatedAt)) / 60_000));
  return wholeMinutes >= 60 ? `${Math.floor(wholeMinutes / 60)} h` : `${wholeMinutes} min`;
}

export function CommandCenter({
  runs,
  selectedRunId,
  onSelectRun,
  loading,
  refreshing,
  statusError,
  approvalPane,
  status,
  refreshedAt,
  now,
  onApproveRun,
  onCancelRun,
  figmaPane,
  incidentAlert,
}: CommandCenterProps) {
  const [runAction, setRunAction] = useState<RunActionState>({});
  const actionInFlight = useRef(false);
  const sortedRuns = [...runs].sort((left, right) => {
    const priorityDifference = runPriority(left.status) - runPriority(right.status);
    return priorityDifference || right.updated_at.localeCompare(left.updated_at);
  });
  const visibleRuns = sortedRuns.slice(0, MAX_RUNS);
  const pendingRuns = runs
    .filter((run) => WAITING_STATUSES.includes(run.status))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const visiblePendingRuns = pendingRuns.slice(0, MAX_PENDING_RUNS);
  const nowMs = (now ?? new Date()).getTime();
  const actionsBusy = runAction.busyRunId !== undefined;

  const performRunAction = async (run: RunRecord, action: RunAction) => {
    const handler = action === "approve" ? onApproveRun : onCancelRun;
    if (handler === undefined || actionInFlight.current) return;
    actionInFlight.current = true;
    setRunAction({
      confirmation: { action, runId: run.current.run_id },
      busyRunId: run.current.run_id,
    });
    try {
      await handler(run);
      setRunAction({});
    } catch (caught) {
      setRunAction({
        confirmation: { action, runId: run.current.run_id },
        actionError: actionErrorMessage(caught),
      });
    } finally {
      actionInFlight.current = false;
    }
  };

  return <div className="command-center">
    {incidentAlert}
    <header className="cc-header">
      <span className="eyebrow">Řízení</span>
      <h2>Command Center</h2>
      <ul className="cc-status-strip" aria-live="polite">
        {loading ? <li>Připojuji Control Plane…</li> : <>
          {statusError ? <li><span className="cc-status-error">Stav není dostupný: {statusError}</span></li> : null}
          {status ? <>
            {typeof status?.sessions?.active === "number" && typeof status?.sessions?.total === "number" ? <li>Relace {status.sessions.active}/{status.sessions.total}</li> : null}
            {typeof status?.approvals?.pending === "number" ? <li>Schválení čeká: {status.approvals.pending}</li> : null}
            {typeof status?.telemetry?.calls === "number" && typeof status?.telemetry?.total_tokens === "number" ? <li>{status.telemetry.calls} volání · {status.telemetry.total_tokens.toLocaleString()} tokenů</li> : null}
          </> : null}
          {refreshedAt ? <li>Obnoveno {refreshedAt.slice(11, 19)} UTC</li> : null}
          {refreshing ? <li>Obnovuji…</li> : null}
        </>}
      </ul>
    </header>
    <section className="cockpit-card cc-section" aria-label="Čeká na mě">
      <h3>Čeká na mě</h3>
      {visiblePendingRuns.length === 0 ? <p className="cc-empty">Žádné běhy nečekají na schválení.</p> : <ul className="cc-pending-list">
        {visiblePendingRuns.map((run) => {
          const runId = run.current.run_id;
          const isSelected = runId === selectedRunId;
          const confirmingAction = runAction.confirmation?.runId === runId ? runAction.confirmation.action : undefined;
          const confirmingApprove = confirmingAction === "approve";
          const confirmingCancel = confirmingAction === "cancel";
          return <li className="cc-pending-run" key={runId}>
            <div className="cc-pending-summary">
              <button type="button" className={isSelected ? "cc-pending-select selected" : "cc-pending-select"} aria-pressed={isSelected} onClick={() => onSelectRun(runId)}>{runId}</button>
              <span>{run.current.provider} · {run.current.model ?? "auto"}</span>
            </div>
            <span className="cc-pending-status">{RUN_STATUS_LABELS[run.status]}</span>
            <div className="cc-pending-actions">
              {run.status === "draft" && onApproveRun ? confirmingApprove ? <div className="cc-pending-confirm" role="group" aria-label={`Potvrzení schválení běhu ${runId}`}>
                <span>Opravdu schválit a spustit běh?</span>
                <button type="button" disabled={actionsBusy} onClick={() => void performRunAction(run, "approve")}>Potvrdit schválení</button>
                <button type="button" disabled={actionsBusy} onClick={() => setRunAction({})}>Ponechat</button>
              </div> : <button type="button" disabled={actionsBusy} onClick={() => setRunAction({ confirmation: { action: "approve", runId } })}>Schválit</button> : null}
              {CANCELLABLE_STATUSES.includes(run.status) && onCancelRun ? confirmingCancel ? <div className="cc-pending-confirm" role="group" aria-label={`Potvrzení zrušení běhu ${runId}`}>
                <span>Opravdu zrušit běh?</span>
                <button type="button" disabled={actionsBusy} onClick={() => void performRunAction(run, "cancel")}>Potvrdit zrušení</button>
                <button type="button" disabled={actionsBusy} onClick={() => setRunAction({})}>Ponechat</button>
              </div> : <button type="button" disabled={actionsBusy} onClick={() => setRunAction({ confirmation: { action: "cancel", runId } })}>Zrušit</button> : null}
            </div>
          </li>;
        })}
      </ul>}
      {pendingRuns.length > MAX_PENDING_RUNS ? <p className="cc-empty">Zobrazeno {MAX_PENDING_RUNS} z {pendingRuns.length} čekajících běhů.</p> : null}
      {runAction.actionError !== undefined ? <p className="cc-action-error" role="alert">Akce selhala: {runAction.actionError}</p> : null}
      <h4 className="cc-subheading">Schválení promptů</h4>
      {approvalPane}
      {figmaPane}
    </section>
    <section className="cockpit-card cc-section" aria-label="Běhy">
      <h3>Běhy</h3>
      {sortedRuns.length === 0 ? <p className="cc-empty">Žádné běhy.</p> : <ul className="cc-run-list">
        {visibleRuns.map((run) => {
          const runId = run.current.run_id;
          const isSelected = runId === selectedRunId;
          const stale = (run.status === "running" || run.status === "queued") && nowMs - Date.parse(run.updated_at) > STALE_RUN_MS;
          return <li key={runId}>
            <button type="button" className={isSelected ? "cc-run-card selected" : "cc-run-card"} aria-pressed={isSelected} onClick={() => onSelectRun(runId)}>
              <span className={runDotClass(run.status)} aria-hidden="true" />
              <span className="cc-run-title">{runId}</span>
              <span className="cc-run-meta">
                <span>{run.current.provider} · {run.current.model ?? "auto"}</span>
                {stale ? <span className="cc-run-chip cc-run-chip-stale">Zastaralé {staleRunAge(run.updated_at, nowMs)}</span> : null}
                {run.dispatch_failure !== null ? <span className="cc-run-chip cc-run-chip-failed">dispatch selhal</span> : null}
                {run.cancellation_requested && run.status !== "cancelled" ? <span className="cc-run-chip cc-run-chip-cancelling">ruší se…</span> : null}
                {run.status === "failed" && run.terminal_reason !== null ? <span className="cc-run-terminal-reason">{run.terminal_reason.slice(0, 80)}</span> : null}
              </span>
              <span className="cc-run-tokens">{run.current.estimated_tokens.toLocaleString()} tokens</span>
              <span className="cc-run-status">{RUN_STATUS_LABELS[run.status]}</span>
            </button>
          </li>;
        })}
      </ul>}
      {sortedRuns.length > MAX_RUNS ? <p className="cc-empty">Zobrazeno {MAX_RUNS} z {sortedRuns.length} běhů.</p> : null}
    </section>
  </div>;
}
