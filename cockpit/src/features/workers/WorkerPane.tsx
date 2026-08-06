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

const statusLabels: Record<WorkerRecord["status"], string> = { running: "Běží", completed: "Dokončeno", blocked: "Blokováno", error: "Chyba" };

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
      setCancelError(caught instanceof Error ? caught.message : "Workera se nepodařilo zrušit");
    } finally {
      setCancelBusyId(null);
    }
  };
  return <div className="worker-pane">
    {error ? <p className="worker-error" role="alert">{error}</p> : null}
    {cancelError ? <p className="worker-error" role="alert">Zrušení selhalo: {cancelError}</p> : null}
    {sorted.length === 0 ? <div className="worker-empty"><p>Žádní běžící workeři.</p><span>Výstup workera se zde zobrazí po spuštění.</span></div> : <>
      <div className="worker-tabs" role="tablist" aria-label="Workeři">
        {sorted.map((worker) => <button key={worker.worker_run_id} type="button" role="tab" aria-selected={selected?.worker_run_id === worker.worker_run_id} onClick={() => selectWorker(worker)}>{worker.vendor} · {worker.worker_run_id.slice(0, 12)}</button>)}
      </div>
      <ul className="worker-list" aria-label="Běhy workerů">
        {sorted.map((worker) => <li key={worker.worker_run_id} className={`worker-card worker-card-${worker.status}`}>
          <button className="worker-card-select" type="button" onClick={() => selectWorker(worker)} aria-label={`Vybrat workera ${worker.worker_run_id}`}>
            <span className="worker-card-title">{worker.vendor} / {worker.model ?? "model není dostupný"}</span>
            <StatusBadge status={worker.status} />
            <span className="worker-card-meta">Relace {worker.session_id} · {elapsedLabel(worker, now)}</span>
          </button>
          {worker.status === "running" ? onCancel === undefined ? <button type="button" className="worker-cancel" disabled aria-label={`Zrušení nedostupné pro ${worker.worker_run_id}`}>Zrušení nedostupné</button> : confirmId === worker.worker_run_id ? <div className="worker-confirm" role="group" aria-label={`Potvrdit zrušení ${worker.worker_run_id}`}><span>Zrušit tohoto workera?</span><button type="button" disabled={cancelBusyId === worker.worker_run_id} onClick={() => void cancelWorker(worker)}>{cancelBusyId === worker.worker_run_id ? "Ruším…" : "Potvrdit zrušení"}</button><button type="button" disabled={cancelBusyId === worker.worker_run_id} onClick={() => setConfirmId(null)}>Ponechat běžet</button></div> : <button type="button" className="worker-cancel" onClick={() => { setCancelError(null); setConfirmId(worker.worker_run_id); }}>Zrušit</button> : null}
        </li>)}
      </ul>
      {selected ? <section className="worker-terminal" aria-labelledby="worker-terminal-heading"><div className="worker-terminal-heading"><h3 id="worker-terminal-heading">Výstup terminálu</h3><span>{statusLabels[selected.status]} · {elapsedLabel(selected, now)}</span></div><pre>{boundedOutputTail(selected.output) || "Žádný zachycený výstup."}</pre>{selected.error_reason ? <p className="worker-error" role="alert">{selected.error_reason}</p> : null}</section> : null}
    </>}
  </div>;
}
