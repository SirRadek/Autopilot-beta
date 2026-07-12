import React, { useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { boundedOutputTail, elapsedLabel, sortWorkers, type WorkerRecord } from "./workerSelectors";

export type WorkerPaneProps = {
  readonly workers: readonly WorkerRecord[];
  readonly selectedWorkerId?: string;
  readonly now?: Date;
  readonly error?: string;
  readonly onSelect?: (worker: WorkerRecord) => void;
  readonly onCancel?: (worker: WorkerRecord) => void | Promise<void>;
};

const statusLabels: Record<WorkerRecord["status"], string> = { running: "Running", completed: "Completed", blocked: "Blocked", error: "Error" };

export function WorkerPane({ workers, selectedWorkerId, now, error, onSelect, onCancel }: WorkerPaneProps) {
  const sorted = sortWorkers(workers);
  const [localSelectedWorkerId, setLocalSelectedWorkerId] = useState<string | undefined>(selectedWorkerId ?? sorted[0]?.worker_run_id);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const activeSelectedWorkerId = selectedWorkerId ?? localSelectedWorkerId;
  const selected = sorted.find((worker) => worker.worker_run_id === activeSelectedWorkerId) ?? sorted[0];
  const selectWorker = (worker: WorkerRecord) => { setLocalSelectedWorkerId(worker.worker_run_id); onSelect?.(worker); };
  const cancelWorker = async (worker: WorkerRecord) => {
    setCancelBusyId(worker.worker_run_id);
    setCancelError(null);
    try {
      await onCancel?.(worker);
      setConfirmId(null);
    } catch (caught) {
      setCancelError(caught instanceof Error ? caught.message : "Unable to cancel worker");
    } finally {
      setCancelBusyId(null);
    }
  };
  return <div className="worker-pane">
    {error ? <p className="worker-error" role="alert">{error}</p> : null}
    {cancelError ? <p className="worker-error" role="alert">Cancel failed: {cancelError}</p> : null}
    {sorted.length === 0 ? <div className="worker-empty"><p>No workers running.</p><span>Worker output will appear here after dispatch.</span></div> : <>
      <div className="worker-tabs" role="tablist" aria-label="Workers">
        {sorted.map((worker) => <button key={worker.worker_run_id} type="button" role="tab" aria-selected={selected?.worker_run_id === worker.worker_run_id} onClick={() => selectWorker(worker)}>{worker.vendor} · {worker.worker_run_id.slice(0, 12)}</button>)}
      </div>
      <ul className="worker-list" aria-label="Worker runs">
        {sorted.map((worker) => <li key={worker.worker_run_id} className={`worker-card worker-card-${worker.status}`}>
          <button className="worker-card-select" type="button" onClick={() => selectWorker(worker)} aria-label={`Select worker ${worker.worker_run_id}`}>
            <span className="worker-card-title">{worker.vendor} / {worker.model ?? "model unavailable"}</span>
            <StatusBadge status={worker.status} />
            <span className="worker-card-meta">Session {worker.session_id} · {elapsedLabel(worker, now)}</span>
          </button>
          {worker.status === "running" ? onCancel === undefined ? <button type="button" className="worker-cancel" disabled aria-label={`Cancel unavailable for ${worker.worker_run_id}`}>Cancel unavailable</button> : confirmId === worker.worker_run_id ? <div className="worker-confirm" role="group" aria-label={`Confirm cancel ${worker.worker_run_id}`}><span>Cancel this worker?</span><button type="button" disabled={cancelBusyId === worker.worker_run_id} onClick={() => void cancelWorker(worker)}>{cancelBusyId === worker.worker_run_id ? "Cancelling…" : "Confirm cancel"}</button><button type="button" disabled={cancelBusyId === worker.worker_run_id} onClick={() => setConfirmId(null)}>Keep running</button></div> : <button type="button" className="worker-cancel" onClick={() => { setCancelError(null); setConfirmId(worker.worker_run_id); }}>Cancel</button> : null}
        </li>)}
      </ul>
      {selected ? <section className="worker-terminal" aria-labelledby="worker-terminal-heading"><div className="worker-terminal-heading"><h3 id="worker-terminal-heading">Terminal tail</h3><span>{statusLabels[selected.status]} · {elapsedLabel(selected, now)}</span></div><pre>{boundedOutputTail(selected.output) || "No output captured."}</pre>{selected.error_reason ? <p className="worker-error" role="alert">{selected.error_reason}</p> : null}</section> : null}
    </>}
  </div>;
}
