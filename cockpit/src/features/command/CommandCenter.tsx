import React from "react";
import type { RunRecord, RunStatus } from "../../types/controlPlane";

export type CommandCenterProps = {
  readonly runs: readonly RunRecord[];
  readonly selectedRunId?: string;
  readonly onSelectRun: (runId: string) => void;
  readonly telemetry?: { readonly calls: number; readonly total_tokens: number };
  readonly loading?: boolean;
  readonly refreshing?: boolean;
  readonly statusError?: string;
  readonly approvalPane: React.ReactNode;
  readonly incidentPane: React.ReactNode;
};

const WAITING_STATUSES: readonly RunStatus[] = ["draft", "approved", "queued"];
const MAX_RUNS = 50;

function runPriority(status: RunStatus): number {
  if (status === "running") return 0;
  if (WAITING_STATUSES.includes(status)) return 1;
  return 2;
}

function runDotClass(status: RunStatus): string {
  if (status === "running") return "cc-run-dot cc-run-dot-running";
  if (WAITING_STATUSES.includes(status)) return "cc-run-dot cc-run-dot-waiting";
  return "cc-run-dot cc-run-dot-idle";
}

function telemetryLine({ loading, refreshing, statusError, telemetry }: Pick<CommandCenterProps, "loading" | "refreshing" | "statusError" | "telemetry">): string {
  if (loading) return "Připojuji Control Plane…";
  if (refreshing) return "Obnovuji…";
  if (statusError) return `Stav není dostupný: ${statusError}`;
  return `${telemetry?.calls ?? 0} worker calls · ${telemetry?.total_tokens ?? 0} tokens`;
}

export function CommandCenter({ runs, selectedRunId, onSelectRun, telemetry, loading, refreshing, statusError, approvalPane, incidentPane }: CommandCenterProps) {
  const sortedRuns = [...runs].sort((a, b) => runPriority(a.status) - runPriority(b.status));
  const visibleRuns = sortedRuns.slice(0, MAX_RUNS);
  return <div className="command-center">
    <header className="cc-header">
      <span className="eyebrow">Řízení</span>
      <h2>Command Center</h2>
      <p className="cc-telemetry" aria-live="polite">{telemetryLine({ loading, refreshing, statusError, telemetry })}</p>
    </header>
    <section className="cockpit-card cc-section" aria-label="Čeká na mě">
      <h3>Čeká na mě</h3>
      {approvalPane}
    </section>
    <section className="cockpit-card cc-section" aria-label="Běhy">
      <h3>Běhy</h3>
      {sortedRuns.length === 0 ? <p className="cc-empty">Žádné běhy.</p> : <ul className="cc-run-list">
        {visibleRuns.map((run) => {
          const runId = run.current.run_id;
          const isSelected = runId === selectedRunId;
          return <li key={runId}>
            <button type="button" className={isSelected ? "cc-run-card selected" : "cc-run-card"} aria-pressed={isSelected} onClick={() => onSelectRun(runId)}>
              <span className={runDotClass(run.status)} aria-hidden="true" />
              <span className="cc-run-title">{runId}</span>
              <span className="cc-run-meta">{run.current.provider} · {run.current.model ?? "auto"}</span>
              <span className="cc-run-tokens">{run.current.estimated_tokens.toLocaleString()} tokens</span>
              <span className="cc-run-status">{run.status}</span>
            </button>
          </li>;
        })}
      </ul>}
      {sortedRuns.length > MAX_RUNS ? <p className="cc-empty">Zobrazeno {MAX_RUNS} z {sortedRuns.length} běhů.</p> : null}
    </section>
    <section className="cockpit-card cc-section" aria-label="Incidenty">
      <h3>Incidenty</h3>
      {incidentPane}
    </section>
  </div>;
}
